<?php
/**
 * AffinMail Admin REST API — single-file router/implementation.
 * Run: php -S 127.0.0.1:8090 -t api/public api/public/index.php
 */

declare(strict_types=1);

const API_VERSION = '1.0.0';
const API_PREFIX  = '/api/v1';

/* ---------------------------------------------------------------- config */

function cfg(string $key, ?string $default = null): string
{
    static $file = null;

    $v = getenv($key);
    if ($v !== false && $v !== '') {
        return $v;
    }
    if ($file === null) {
        $file = [];
        $p = dirname(__DIR__) . '/.env';
        if (is_readable($p)) {
            foreach (file($p, FILE_IGNORE_NEW_LINES) as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
                    continue;
                }
                [$k, $val] = explode('=', $line, 2);
                $file[trim($k)] = trim($val);
            }
        }
    }
    return $file[$key] ?? ($default ?? '');
}

/* ---------------------------------------------------------------- state */

$GLOBALS['resp_status'] = 200;
$GLOBALS['audit'] = null;

register_shutdown_function(static function (): void {
    $a = $GLOBALS['audit'];
    if (!$a) {
        return;
    }
    $log = cfg('AUDIT_LOG', dirname(__DIR__) . '/logs/admin-agent-audit.log');
    $dir = dirname($log);
    if (!is_dir($dir)) {
        @mkdir($dir, 0750, true);
    }
    $line = json_encode([
        'ts'     => gmdate('c'),
        'agent'  => $a['agent'],
        'method' => $a['method'],
        'path'   => $a['path'],
        'status' => $GLOBALS['resp_status'],
    ], JSON_UNESCAPED_SLASHES);
    @file_put_contents($log, $line . "\n", FILE_APPEND | LOCK_EX);
});

/* ---------------------------------------------------------------- http */

function respond(int $code, array $payload): never
{
    $GLOBALS['resp_status'] = $code;
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function ok(mixed $data, int $code = 200): never
{
    respond($code, ['status' => 'success', 'data' => $data]);
}

function fail(int $code, string $msg): never
{
    $reqPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    if (str_starts_with($reqPath, API_PREFIX . '/provision/') || str_starts_with($reqPath, API_PREFIX . '/client/')) {
        apiFail($code, $msg);
    }
    respond($code, ['status' => 'error', 'error' => $msg]);
}

function apiFail(int $code, string $msg): never
{
    $GLOBALS['resp_status'] = $code;
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'error' => [
            'code'    => $code,
            'message' => $msg,
        ],
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $d = json_decode($raw, true);
    if (!is_array($d)) {
        fail(400, 'invalid JSON body');
    }
    return $d;
}

/* ---------------------------------------------------------------- db / redis */

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s', cfg('DB_HOST', '127.0.0.1'), cfg('DB_PORT', '5432'), cfg('DB_NAME', 'affinmail'));
    $pdo = new PDO($dsn, cfg('DB_USER'), cfg('DB_PASSWORD'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    return $pdo;
}

function redis(): Redis
{
    static $r = null;
    if ($r instanceof Redis) {
        return $r;
    }
    $url = parse_url(cfg('REDIS_URL', 'redis://127.0.0.1:6379'));
    $r = new Redis();
    $r->connect($url['host'] ?? '127.0.0.1', (int)($url['port'] ?? 6379), 2.0);
    $pass = cfg('REDIS_PASSWORD');
    if ($pass !== '') {
        $r->auth($pass);
    }
    return $r;
}

/* ---------------------------------------------------------------- stalwart */

function jmap(string $method, array $args): array
{
    $payload = json_encode([
        'using'       => ['urn:stalwart:jmap'],
        'methodCalls' => [[$method, $args, 'c1']],
    ], JSON_UNESCAPED_SLASHES);

    $ch = curl_init(cfg('STALWART_URL', 'http://127.0.0.1:8080') . '/jmap');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_USERPWD        => cfg('STALWART_ADMIN_USER') . ':' . cfg('STALWART_ADMIN_PASSWORD'),
    ]);
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($raw === false || $code !== 200) {
        throw new RuntimeException('stalwart jmap ' . $method . ' failed (http ' . $code . ')' . ($err !== '' ? ': ' . $err : ''));
    }
    $d = json_decode($raw, true);
    if (!is_array($d) || !isset($d['methodResponses'][0])) {
        throw new RuntimeException('stalwart jmap ' . $method . ' returned malformed response');
    }
    [$name, $res] = [$d['methodResponses'][0][0], $d['methodResponses'][0][1]];
    if ($name === 'error') {
        throw new RuntimeException('stalwart ' . ($res['type'] ?? 'error') . ': ' . ($res['description'] ?? 'request failed'));
    }
    return $res;
}

function stalwartAdminAccountId(): string
{
    static $id = null;
    if ($id !== null) {
        return $id;
    }
    try {
        $cached = redis()->get('stalwart:accountid');
    } catch (Throwable) {
        $cached = null;
    }
    if (is_string($cached) && $cached !== '') {
        return $id = $cached;
    }

    $ch = curl_init(cfg('STALWART_URL', 'http://127.0.0.1:8080') . '/jmap/session');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_USERPWD        => cfg('STALWART_ADMIN_USER') . ':' . cfg('STALWART_ADMIN_PASSWORD'),
    ]);
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($raw === false || $code !== 200) {
        throw new RuntimeException('stalwart session unavailable');
    }
    $d = json_decode($raw, true);
    $acct = array_key_first($d['accounts'] ?? []);
    if (!is_string($acct) || $acct === '') {
        throw new RuntimeException('stalwart session has no accounts');
    }
    try {
        redis()->setex('stalwart:accountid', 300, $acct);
    } catch (Throwable) {
    }
    return $id = $acct;
}

function stalwartDomains(): array
{
    $res = jmap('x:Domain/get', ['accountId' => stalwartAdminAccountId(), 'ids' => null]);
    return $res['list'] ?? [];
}

function stalwartFindDomain(string $name): ?array
{
    foreach (stalwartDomains() as $d) {
        if (strcasecmp((string)($d['name'] ?? ''), $name) === 0) {
            return $d;
        }
    }
    return null;
}

function stalwartEnsureDomain(string $name): string
{
    $found = stalwartFindDomain($name);
    if ($found !== null) {
        return (string)$found['id'];
    }
    $res = jmap('x:Domain/set', [
        'accountId' => stalwartAdminAccountId(),
        'create'    => ['x1' => ['name' => $name, 'enable' => true]],
    ]);
    $id = $res['created']['x1']['id'] ?? null;
    if (!is_string($id) || $id === '') {
        throw new RuntimeException('stalwart domain create failed: ' . json_encode($res['notCreated'] ?? []));
    }
    return $id;
}

function stalwartAccounts(): array
{
    $res = jmap('x:Account/get', ['accountId' => stalwartAdminAccountId(), 'ids' => null]);
    return $res['list'] ?? [];
}

function stalwartFindAccountByEmail(string $email): ?array
{
    foreach (stalwartAccounts() as $a) {
        if (strcasecmp((string)($a['emailAddress'] ?? ''), $email) === 0) {
            return $a;
        }
    }
    return null;
}

function stalwartAccountById(string $id): ?array
{
    foreach (stalwartAccounts() as $a) {
        if ((string)($a['id'] ?? '') === $id) {
            return $a;
        }
    }
    return null;
}

function stalwartSetAccount(array $args): array
{
    $res = jmap('x:Account/set', $args + ['accountId' => stalwartAdminAccountId()]);
    foreach (['notCreated', 'notUpdated', 'notDestroyed'] as $k) {
        if (!empty($res[$k])) {
            throw new RuntimeException('stalwart account update rejected: ' . json_encode($res[$k]));
        }
    }
    return $res;
}

function stalwartSetPassword(string $accountId, string $secret): void
{
    $payload = ['@type' => 'Password', 'secret' => $secret];
    try {
        stalwartSetAccount(['update' => [$accountId => ['credentials/0' => $payload]]]);
        return;
    } catch (Throwable) {
        // fall through to legacy patch form
    }
    stalwartSetAccount(['update' => [$accountId => ['credentials' => ['0' => $payload]]]]);
}

function stalwartCreateAccount(string $localpart, string $domainId, string $displayName, string $secret): string
{
    $res = stalwartSetAccount([
        'create' => ['a1' => [
            '@type'       => 'User',
            'name'        => $localpart,
            'domainId'    => $domainId,
            'description' => $displayName,
            'roles'       => ['@type' => 'User'],
            // JSON object, not PHP list: credential keys are "0".
            'credentials' => (object)['0' => ['@type' => 'Password', 'secret' => $secret]],
        ]],
    ]);
    $id = $res['created']['a1']['id'] ?? null;
    if (!is_string($id) || $id === '') {
        throw new RuntimeException('stalwart account create failed');
    }
    return $id;
}

function stalwartDestroyAccount(string $id): void
{
    stalwartSetAccount(['destroy' => [$id]]);
}

function stalwartDestroyDomain(string $domainId): void
{
    $acct = stalwartAdminAccountId();
    $dkim = jmap('x:DkimSignature/get', ['accountId' => $acct, 'ids' => null])['list'] ?? [];
    $sigIds = array_values(array_map(
        static fn(array $s): string => (string)$s['id'],
        array_filter($dkim, static fn(array $s): bool => (string)($s['domainId'] ?? '') === $domainId)
    ));
    if ($sigIds !== []) {
        jmap('x:DkimSignature/set', ['accountId' => $acct, 'destroy' => $sigIds]);
    }
    foreach (stalwartAccounts() as $a) {
        if ((string)($a['domainId'] ?? '') === $domainId) {
            stalwartDestroyAccount((string)$a['id']);
        }
    }
    jmap('x:Domain/set', ['accountId' => $acct, 'destroy' => [$domainId]]);
}

/* ---------------------------------------------------------------- vault */

function vaultKey(): string
{
    $k = cfg('VAULT_KEY');
    if ($k === '') {
        throw new RuntimeException('VAULT_KEY not configured');
    }
    return preg_match('/^[0-9a-f]{64}$/i', $k) === 1 ? hex2bin($k) : hash('sha256', $k, true);
}

function vaultEncrypt(string $plain): string
{
    $iv = random_bytes(12);
    $tag = '';
    $ct = openssl_encrypt($plain, 'aes-256-gcm', vaultKey(), OPENSSL_RAW_DATA, $iv, $tag);
    if ($ct === false) {
        throw new RuntimeException('vault encryption failed');
    }
    return base64_encode($iv) . '.' . base64_encode($tag) . '.' . base64_encode($ct);
}

function vaultDecrypt(string $blob): string
{
    $parts = explode('.', $blob);
    if (count($parts) !== 3) {
        throw new RuntimeException('vault value malformed');
    }
    [$iv, $tag, $ct] = array_map(static fn(string $p): string => base64_decode($p, true) ?: '', $parts);
    $plain = openssl_decrypt($ct, 'aes-256-gcm', vaultKey(), OPENSSL_RAW_DATA, $iv, $tag);
    if ($plain === false) {
        throw new RuntimeException('vault decryption failed');
    }
    return $plain;
}

/* ---------------------------------------------------------------- validation */

function validDomain(string $d): bool
{
    return preg_match('/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i', $d) === 1;
}

function validEmail(string $e): bool
{
    if (strlen($e) > 255 || substr_count($e, '@') !== 1) {
        return false;
    }
    [$local, $domain] = explode('@', $e);
    return $local !== '' && strlen($local) <= 64
        && preg_match('/^[A-Za-z0-9._%+\-]+$/', $local) === 1
        && validDomain($domain);
}

function intField(array $b, string $key, int $default, int $min = 1, int $max = PHP_INT_MAX): int
{
    if (!array_key_exists($key, $b) || $b[$key] === null) {
        return $default;
    }
    if (!is_int($b[$key]) && !(is_string($b[$key]) && ctype_digit($b[$key]))) {
        fail(400, "field '$key' must be a positive integer");
    }
    $v = (int)$b[$key];
    if ($v < $min || $v > $max) {
        fail(400, "field '$key' out of range");
    }
    return $v;
}

function stringField(array $b, string $key, int $maxLen = 255, bool $required = true): string
{
    $v = $b[$key] ?? null;
    if ($v === null || $v === '') {
        if ($required) {
            fail(400, "field '$key' is required");
        }
        return '';
    }
    if (!is_string($v) || strlen($v) > $maxLen) {
        fail(400, "field '$key' invalid");
    }
    return $v;
}

/* ---------------------------------------------------------------- mapper */

function domainOut(array $r): array
{
    return [
        'domain'            => $r['domain_name'],
        'maxMailboxes'      => (int)$r['max_mailboxes'],
        'diskQuotaMb'       => (int)$r['disk_quota_mb'],
        'maxAttachmentMb'   => (int)$r['max_attachment_size_mb'],
        'hostaffinServiceId' => $r['hostaffin_service_id'] === null ? null : (int)$r['hostaffin_service_id'],
        'dkimSelector'      => $r['dkim_selector'],
        'dkimPublicKey'     => $r['dkim_public_key'],
        'stalwartDomainId'  => $r['stalwart_domain_id'] ?? null,
        'isActive'          => (bool)$r['is_active'],
        'assignedIpId'      => $r['assigned_ip_id'] ?? null,
        'mailboxCount'      => isset($r['mailbox_count']) ? (int)$r['mailbox_count'] : null,
        'createdAt'         => $r['created_at'],
    ];
}

function mailboxOut(array $r): array
{
    return [
        'id'              => $r['id'],
        'email'           => $r['email'],
        'displayName'     => $r['display_name'],
        'quotaLimitMb'    => (int)$r['quota_limit_mb'],
        'quotaUsedBytes'  => (int)$r['quota_used_bytes'],
        'hourlyRateLimit' => (int)$r['hourly_rate_limit'],
        'outboundRoute'   => $r['outbound_route'],
        'status'          => $r['status'],
        'domain'          => $r['domain_name'] ?? null,
        'stalwartAccountId' => $r['stalwart_account_id'] ?? null,
        'createdAt'       => $r['created_at'],
    ];
}

/* ---------------------------------------------------------------- dkim */

function dkimKeypair(): array
{
    $res = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    if ($res === false || !openssl_pkey_export($res, $pem)) {
        throw new RuntimeException('DKIM key generation failed');
    }
    $details = openssl_pkey_get_details($res);
    $pubPem = $details['key'] ?? '';
    $pubB64 = preg_replace('/-----(BEGIN|END) PUBLIC KEY-----|\s+/', '', $pubPem);
    if (!is_string($pubB64) || $pubB64 === '') {
        throw new RuntimeException('DKIM public key extraction failed');
    }
    return [$pem, $pubB64];
}

/* ---------------------------------------------------------------- routes data */

function domainCreate(): never
{
    $b = body();
    $name = strtolower(stringField($b, 'domain'));
    if (!validDomain($name)) {
        fail(400, 'invalid domain name');
    }
    $maxMailboxes    = intField($b, 'maxMailboxes', 5, 1, 100000);
    $diskQuotaMb     = intField($b, 'diskQuotaMb', 10240, 1, 10000000);
    $maxAttachmentMb = intField($b, 'maxAttachmentMb', 25, 1, 1024);
    $serviceId       = array_key_exists('hostaffinServiceId', $b) && $b['hostaffinServiceId'] !== null
        ? intField($b, 'hostaffinServiceId', 1, 1) : null;

    $pdo = db();
    $exists = $pdo->prepare('SELECT 1 FROM domains WHERE domain_name = ?');
    $exists->execute([$name]);
    if ($exists->fetchColumn()) {
        fail(409, 'domain already exists');
    }

    try {
        [$priv, $pub] = dkimKeypair();
        $swId = stalwartEnsureDomain($name);
    } catch (RuntimeException $e) {
        fail(502, $e->getMessage());
    }

    $st = $pdo->prepare(
        'INSERT INTO domains (domain_name, hostaffin_service_id, max_mailboxes, max_attachment_size_mb,
                              disk_quota_mb, dkim_selector, dkim_private_key, dkim_public_key, stalwart_domain_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *'
    );
    $st->execute([$name, $serviceId, $maxMailboxes, $maxAttachmentMb, $diskQuotaMb, 'affinmail', $priv, $pub, $swId]);
    ok(domainOut($st->fetch()), 201);
}

function domainList(): never
{
    $rows = db()->query(
        'SELECT d.*, COUNT(m.id) AS mailbox_count
         FROM domains d LEFT JOIN mailboxes m ON m.domain_id = d.id
         GROUP BY d.id ORDER BY d.domain_name'
    )->fetchAll();
    ok(['domains' => array_map('domainOut', $rows), 'count' => count($rows)]);
}

function domainGet(string $name): never
{
    $st = db()->prepare(
        'SELECT d.*, (SELECT COUNT(*) FROM mailboxes m WHERE m.domain_id = d.id) AS mailbox_count
         FROM domains d WHERE d.domain_name = ?'
    );
    $st->execute([strtolower($name)]);
    $row = $st->fetch();
    if (!$row) {
        fail(404, 'domain not found');
    }
    $out = domainOut($row);
    $out['catchAllAddress'] = stalwartCatchAll($row);
    ok($out);
}

function stalwartSignaturesForDomain(string $domainId): array
{
    try {
        $res = jmap('x:DkimSignature/get', ['accountId' => stalwartAdminAccountId(), 'ids' => null]);
    } catch (Throwable) {
        return [];
    }
    return array_values(array_filter(
        $res['list'] ?? [],
        static fn(array $s): bool => (string)($s['domainId'] ?? '') === $domainId
    ));
}

/**
 * DNS records a domain must publish. DKIM entries are built from the
 * signatures Stalwart actually signs with (it auto-generates its own keys
 * per domain) - the keypair stored in PostgreSQL at domain creation is NOT
 * what the server signs with, so it must not be served as the DNS record.
 */
function domainDnsRecords(array $row): array
{
    $records = [
        ['type' => 'MX', 'name' => '@', 'value' => 'affinmail.hostaffin.com', 'priority' => 10],
        ['type' => 'TXT', 'name' => '@', 'value' => 'v=spf1 mx include:_spf.hostaffin.com ~all'],
    ];
    $dkimAdded = false;
    if (!empty($row['stalwart_domain_id'])) {
        foreach (stalwartSignaturesForDomain((string)$row['stalwart_domain_id']) as $s) {
            if (($s['stage'] ?? 'active') !== 'active') {
                continue;
            }
            $algo = str_contains((string)($s['@type'] ?? ''), 'Ed25519') ? 'ed25519' : 'rsa';
            $records[] = [
                'type' => 'TXT', 'name' => (string)$s['selector'] . '._domainkey',
                'value' => 'v=DKIM1; k=' . $algo . '; p=' . (string)($s['publicKey'] ?? ''),
                'selector' => (string)$s['selector'], 'algorithm' => $algo,
            ];
            $dkimAdded = true;
        }
    }
    if (!$dkimAdded && !empty($row['dkim_public_key'])) {
        $records[] = [
            'type' => 'TXT', 'name' => $row['dkim_selector'] . '._domainkey',
            'value' => 'v=DKIM1; k=rsa; p=' . $row['dkim_public_key'],
            'selector' => (string)$row['dkim_selector'], 'algorithm' => 'rsa',
        ];
    }
    $records[] = ['type' => 'TXT', 'name' => '_dmarc', 'value' => 'v=DMARC1; p=quarantine; rua=mailto:dmarc@' . $row['domain_name']];
    return $records;
}

function domainDns(string $name): never
{
    $st = db()->prepare('SELECT * FROM domains WHERE domain_name = ?');
    $st->execute([strtolower($name)]);
    $row = $st->fetch();
    if (!$row) {
        fail(404, 'domain not found');
    }
    ok([
        'domain'  => $row['domain_name'],
        'records' => domainDnsRecords($row),
    ]);
}

function stalwartCatchAll(array $row): ?string
{
    if (empty($row['stalwart_domain_id'])) {
        return null;
    }
    try {
        $d = jmap('x:Domain/get', [
            'accountId'  => stalwartAdminAccountId(),
            'ids'        => [(string)$row['stalwart_domain_id']],
            'properties' => ['catchAllAddress'],
        ]);
        $ca = $d['list'][0]['catchAllAddress'] ?? null;
        return is_string($ca) && $ca !== '' ? $ca : null;
    } catch (Throwable) {
        return null;
    }
}

function domainDelete(string $name): never
{
    $name = strtolower($name);
    $pdo = db();
    $st = $pdo->prepare('SELECT * FROM domains WHERE domain_name = ?');
    $st->execute([$name]);
    $row = $st->fetch();
    if (!$row) {
        fail(404, 'domain not found');
    }

    try {
        $swId = $row['stalwart_domain_id'];
        if ($swId === null || $swId === '') {
            $found = stalwartFindDomain($name);
            $swId = $found['id'] ?? null;
        }
        if (is_string($swId) && $swId !== '') {
            stalwartDestroyDomain($swId);
        }
    } catch (RuntimeException $e) {
        fail(502, 'stalwart cleanup failed: ' . $e->getMessage());
    }

    $pdo->prepare('DELETE FROM domains WHERE id = ?')->execute([$row['id']]);
    ok(['deleted' => $name]);
}

/* ---------------------------------------------------------------- mailboxes */

/**
 * Ensure a PG domain row exists (auto-create with defaults + Stalwart domain).
 * Returns the domain row.
 */
function ensurePgDomain(string $name): array
{
    $pdo = db();
    $st = $pdo->prepare('SELECT * FROM domains WHERE domain_name = ?');
    $st->execute([$name]);
    $row = $st->fetch();
    if ($row) {
        return $row;
    }

    [$priv, $pub] = dkimKeypair();
    $swId = stalwartEnsureDomain($name);
    $ins = $pdo->prepare(
        'INSERT INTO domains (domain_name, max_mailboxes, max_attachment_size_mb, disk_quota_mb,
                              dkim_selector, dkim_private_key, dkim_public_key, stalwart_domain_id)
         VALUES (?, 5, 25, 10240, ?, ?, ?, ?) RETURNING *'
    );
    $ins->execute([$name, 'affinmail', $priv, $pub, $swId]);
    return $ins->fetch();
}

function mailboxCreate(): never
{
    $b = body();
    $email = strtolower(stringField($b, 'email'));
    if (!validEmail($email)) {
        fail(400, 'invalid email address');
    }
    $password = stringField($b, 'password');
    if (strlen($password) < 8 || strlen($password) > 256) {
        fail(400, 'password must be 8-256 characters');
    }
    $displayName     = stringField($b, 'displayName', 128, false);
    $quotaLimitMb    = intField($b, 'quotaLimitMb', 5120, 1, 10000000);
    $hourlyRateLimit = intField($b, 'hourlyRateLimit', 200, 0, 1000000);
    $outboundRoute   = $b['outboundRoute'] ?? 'direct';
    if (!in_array($outboundRoute, ['direct', 'relay_ses', 'relay_sendgrid', 'relay_custom'], true)) {
        fail(400, 'invalid outboundRoute');
    }

    [$localpart, $domainName] = explode('@', $email);

    $pdo = db();
    $dup = $pdo->prepare('SELECT 1 FROM mailboxes WHERE email = ?');
    $dup->execute([$email]);
    if ($dup->fetchColumn()) {
        fail(409, 'mailbox already exists');
    }

    try {
        $domain = ensurePgDomain($domainName);
    } catch (RuntimeException $e) {
        fail(502, $e->getMessage());
    }

    $cnt = $pdo->prepare('SELECT COUNT(*) FROM mailboxes WHERE domain_id = ?');
    $cnt->execute([$domain['id']]);
    if ((int)$cnt->fetchColumn() >= (int)$domain['max_mailboxes']) {
        fail(409, 'domain mailbox limit reached');
    }

    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare(
            'INSERT INTO mailboxes (domain_id, email, username, password_hash, display_name, quota_limit_mb,
                                    hourly_rate_limit, outbound_route, secret_vault)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'
        );
        $st->execute([
            $domain['id'], $email, $localpart, password_hash($password, PASSWORD_ARGON2ID),
            $displayName, $quotaLimitMb, $hourlyRateLimit, $outboundRoute, vaultEncrypt($password),
        ]);
        $mailboxId = $st->fetchColumn();

        $acct = stalwartFindAccountByEmail($email);
        if ($acct !== null) {
            $swAccountId = (string)$acct['id'];
            stalwartSetPassword($swAccountId, $password);
        } else {
            $swAccountId = stalwartCreateAccount($localpart, (string)$domain['stalwart_domain_id'], $displayName, $password);
        }

        $pdo->prepare('UPDATE mailboxes SET stalwart_account_id = ? WHERE id = ?')
            ->execute([$swAccountId, $mailboxId]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        fail(502, 'mailbox provisioning failed: ' . $e->getMessage());
    }

    $st = $pdo->prepare('SELECT m.*, d.domain_name FROM mailboxes m JOIN domains d ON d.id = m.domain_id WHERE m.id = ?');
    $st->execute([$mailboxId]);
    ok(mailboxOut($st->fetch()), 201);
}

function mailboxList(): never
{
    $domFilter = isset($_GET['domain']) && is_string($_GET['domain']) ? strtolower($_GET['domain']) : null;
    $sql = 'SELECT m.*, d.domain_name FROM mailboxes m JOIN domains d ON d.id = m.domain_id';
    $args = [];
    if ($domFilter !== null && $domFilter !== '') {
        $sql .= ' WHERE d.domain_name = ?';
        $args[] = $domFilter;
    }
    $sql .= ' ORDER BY m.email';
    $st = db()->prepare($sql);
    $st->execute($args);
    $rows = $st->fetchAll();
    $out = array_map('mailboxOut', $rows);
    $seen = [];
    foreach ($out as $o) {
        $seen[strtolower((string)$o['email'])] = true;
    }
    // Merge in mailboxes that exist only in Stalwart (created directly on the
    // mail server, e.g. the server admin account and early test mailboxes) so
    // the panel can manage every real mailbox on the server.
    try {
        foreach (stalwartAccounts() as $a) {
            $email = strtolower((string)($a['emailAddress'] ?? ''));
            if ($email === '' || isset($seen[$email])) {
                continue;
            }
            if ($domFilter !== null && $domFilter !== '' && !str_ends_with($email, '@' . $domFilter)) {
                continue;
            }
            $quota = $a['quota'] ?? null;
            $out[] = [
                'id'                => 'stalwart:' . (string)($a['id'] ?? ''),
                'email'             => $email,
                'displayName'       => (string)($a['description'] ?? $a['name'] ?? ''),
                'quotaLimitMb'      => is_numeric($quota) ? (int)round(((float)$quota) / 1048576) : 0,
                'quotaUsedBytes'    => 0,
                'hourlyRateLimit'   => 0,
                'outboundRoute'     => 'direct',
                'status'            => !empty($a['isDisabled']) ? 'suspended' : 'active',
                'domain'            => substr($email, strpos($email, '@') + 1),
                'stalwartAccountId' => (string)($a['id'] ?? ''),
                'createdAt'         => '',
            ];
            $seen[$email] = true;
        }
    } catch (Throwable) {
        // Stalwart unavailable: serve the billing mirror only.
    }
    usort($out, static fn(array $x, array $y): int => strcmp((string)$x['email'], (string)$y['email']));
    ok(['mailboxes' => $out, 'count' => count($out)]);
}

function mailboxFind(string $email): array
{
    $st = db()->prepare('SELECT m.*, d.domain_name FROM mailboxes m JOIN domains d ON d.id = m.domain_id WHERE m.email = ?');
    $st->execute([strtolower($email)]);
    $row = $st->fetch();
    if (!$row) {
        fail(404, 'mailbox not found');
    }
    return $row;
}

function mailboxGet(string $email): never
{
    ok(mailboxOut(mailboxFind($email)));
}

function mailboxQuota(string $email): never
{
    $row = mailboxFind($email);
    $b = body();
    if (!array_key_exists('quotaLimitMb', $b) && !array_key_exists('hourlyRateLimit', $b) && !array_key_exists('outboundRoute', $b)) {
        fail(400, 'nothing to update');
    }
    $sets = [];
    $args = [];
    if (array_key_exists('quotaLimitMb', $b)) {
        $sets[] = 'quota_limit_mb = ?';
        $args[] = intField($b, 'quotaLimitMb', 1, 1, 10000000);
    }
    if (array_key_exists('hourlyRateLimit', $b)) {
        $sets[] = 'hourly_rate_limit = ?';
        $args[] = intField($b, 'hourlyRateLimit', 200, 0, 1000000);
    }
    if (array_key_exists('outboundRoute', $b)) {
        $r = $b['outboundRoute'];
        if (!in_array($r, ['direct', 'relay_ses', 'relay_sendgrid', 'relay_custom'], true)) {
            fail(400, 'invalid outboundRoute');
        }
        $sets[] = 'outbound_route = ?';
        $args[] = $r;
    }
    $sets[] = 'updated_at = NOW()';
    $args[] = $row['id'];
    db()->prepare('UPDATE mailboxes SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($args);

    $st = db()->prepare('SELECT m.*, d.domain_name FROM mailboxes m JOIN domains d ON d.id = m.domain_id WHERE m.id = ?');
    $st->execute([$row['id']]);
    ok(mailboxOut($st->fetch()));
}

function mailboxStatus(string $email): never
{
    $row = mailboxFind($email);
    $b = body();
    $status = $b['status'] ?? null;
    if (!in_array($status, ['suspended', 'active'], true)) {
        fail(400, 'status must be "suspended" or "active"');
    }
    $swId = !empty($row['stalwart_account_id'])
        ? (string)$row['stalwart_account_id']
        : (string)(stalwartFindAccountByEmail($row['email'])['id'] ?? '');
    if ($swId === '') {
        fail(409, 'mailbox has no Stalwart account');
    }

    try {
        if ($status === 'suspended') {
            stalwartSetAccount(['update' => [$swId => ['isDisabled' => true]]]);
        } else {
            stalwartSetAccount(['update' => [$swId => ['isDisabled' => false]]]);
            // Legacy rows suspended by password scramble get their real
            // password back from the vault.
            if (!empty($row['secret_vault'])) {
                stalwartSetPassword($swId, vaultDecrypt($row['secret_vault']));
            }
        }
    } catch (RuntimeException $e) {
        fail(502, 'stalwart update failed: ' . $e->getMessage());
    }

    db()->prepare('UPDATE mailboxes SET status = ?, updated_at = NOW() WHERE id = ?')
        ->execute([$status, $row['id']]);

    $row['status'] = $status;
    ok(mailboxOut($row));
}

function mailboxDelete(string $email): never
{
    $row = mailboxFind($email);
    if (!empty($row['stalwart_account_id'])) {
        try {
            stalwartDestroyAccount((string)$row['stalwart_account_id']);
        } catch (RuntimeException $e) {
            fail(502, 'stalwart account delete failed: ' . $e->getMessage());
        }
    }
    db()->prepare('DELETE FROM mailboxes WHERE id = ?')->execute([$row['id']]);
    ok(['deleted' => $row['email']]);
}

/* ---------------------------------------------------------------- aliases */

function aliasCreate(): never
{
    $b = body();
    $source = strtolower(stringField($b, 'source_address', 255, false) ?: stringField($b, 'source'));
    $dest   = strtolower(stringField($b, 'destination_address', 255, false) ?: stringField($b, 'destination'));
    if (!validEmail($source) || !validEmail($dest)) {
        fail(400, 'invalid source or destination address');
    }

    $pdo = db();
    $dm = $pdo->prepare('SELECT m.*, d.domain_name FROM mailboxes m JOIN domains d ON d.id = m.domain_id WHERE m.email = ?');
    $dm->execute([$dest]);
    $destBox = $dm->fetch();
    if (!$destBox) {
        fail(404, 'destination mailbox not found');
    }

    [$srcLocal, $srcDomain] = explode('@', $source);
    $ds = $pdo->prepare('SELECT * FROM domains WHERE domain_name = ?');
    $ds->execute([$srcDomain]);
    $srcDomainRow = $ds->fetch();
    if (!$srcDomainRow) {
        fail(404, 'source domain not found');
    }

    $dup = $pdo->prepare('SELECT 1 FROM aliases WHERE source_address = ? AND destination_address = ?');
    $dup->execute([$source, $dest]);
    if ($dup->fetchColumn()) {
        fail(409, 'alias already exists');
    }

    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare(
            'INSERT INTO aliases (domain_id, source_address, destination_address)
             VALUES (?, ?, ?) RETURNING id, created_at'
        );
        $st->execute([$srcDomainRow['id'], $source, $dest]);
        $aliasRow = $st->fetch();

        $swDomainId = $srcDomainRow['stalwart_domain_id'];
        if ($swDomainId === null || $swDomainId === '') {
            $swDomainId = stalwartEnsureDomain($srcDomain);
            $pdo->prepare('UPDATE domains SET stalwart_domain_id = ? WHERE id = ?')
                ->execute([$swDomainId, $srcDomainRow['id']]);
        }

        $swAccountId = $destBox['stalwart_account_id'];
        $account = $swAccountId !== null && $swAccountId !== ''
            ? stalwartAccountById((string)$swAccountId)
            : stalwartFindAccountByEmail($dest);
        if ($account === null) {
            throw new RuntimeException('destination mailbox has no Stalwart account');
        }
        $swAccountId = (string)$account['id'];

        $idx = 0;
        foreach (array_keys($account['aliases'] ?? []) as $k) {
            if (ctype_digit((string)$k)) {
                $idx = max($idx, (int)$k + 1);
            }
        }
        $key = 'aliases/' . $idx;
        stalwartSetAccount(['update' => [$swAccountId => [$key => [
            'name'     => $srcLocal,
            'domainId' => $swDomainId,
            'enable'   => true,
        ]]]]);

        $pdo->prepare('UPDATE aliases SET stalwart_account_id = ?, stalwart_alias_key = ? WHERE id = ?')
            ->execute([$swAccountId, $key, $aliasRow['id']]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        fail(502, 'alias provisioning failed: ' . $e->getMessage());
    }

    ok([
        'id'                  => $aliasRow['id'],
        'source_address'      => $source,
        'destination_address' => $dest,
        'domain'              => $srcDomain,
        'isActive'            => true,
        'stalwartAccountId'   => $swAccountId,
        'stalwartAliasKey'    => $key,
        'createdAt'           => $aliasRow['created_at'],
    ], 201);
}

function aliasList(): never
{
    $rows = db()->query(
        'SELECT a.*, d.domain_name FROM aliases a JOIN domains d ON d.id = a.domain_id ORDER BY a.created_at DESC'
    )->fetchAll();
    ok(['aliases' => array_map(static fn(array $r): array => [
        'id'                  => $r['id'],
        'source_address'      => $r['source_address'],
        'destination_address' => $r['destination_address'],
        'domain'              => $r['domain_name'],
        'isActive'            => (bool)$r['is_active'],
        'stalwartAccountId'   => $r['stalwart_account_id'],
        'stalwartAliasKey'    => $r['stalwart_alias_key'],
        'createdAt'           => $r['created_at'],
    ], $rows), 'count' => count($rows)]);
}

function aliasDelete(string $id): never
{
    if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $id) !== 1) {
        fail(400, 'invalid alias id');
    }
    $st = db()->prepare('SELECT * FROM aliases WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        fail(404, 'alias not found');
    }

    if (!empty($row['stalwart_account_id']) && !empty($row['stalwart_alias_key'])) {
        try {
            stalwartSetAccount(['update' => [(string)$row['stalwart_account_id'] => [
                (string)$row['stalwart_alias_key'] => null,
            ]]]);
        } catch (RuntimeException $e) {
            fail(502, 'stalwart alias delete failed: ' . $e->getMessage());
        }
    }

    db()->prepare('DELETE FROM aliases WHERE id = ?')->execute([$id]);
    ok(['deleted' => $id]);
}

/* ---------------------------------------------------------------- mail queue */

function queueList(): never
{
    $res = jmap('x:QueuedMessage/get', ['accountId' => stalwartAdminAccountId(), 'ids' => null]);
    $items = $res['list'] ?? [];
    ok(['messages' => $items, 'count' => count($items)]);
}

function queueDelete(string $id): never
{
    $res = jmap('x:QueuedMessage/set', ['accountId' => stalwartAdminAccountId(), 'destroy' => [$id]]);
    if (!empty($res['notDestroyed'][$id])) {
        fail(404, 'queued message not found');
    }
    ok(['deleted' => $id]);
}

function queueRetry(string $id): never
{
    $res = jmap('x:QueuedMessage/get', ['accountId' => stalwartAdminAccountId(), 'ids' => [$id]]);
    $item = $res['list'][0] ?? null;
    if ($item === null) {
        fail(404, 'queued message not found');
    }
    $field = null;
    foreach (['nextRetry', 'nextDelivery', 'nextAttempt'] as $f) {
        if (array_key_exists($f, $item)) {
            $field = $f;
            break;
        }
    }
    if ($field === null) {
        fail(501, 'this queued message cannot be rescheduled from the panel');
    }
    $upd = jmap('x:QueuedMessage/set', [
        'accountId' => stalwartAdminAccountId(),
        'update'    => [$id => [$field => gmdate('Y-m-d\\TH:i:s\\Z')]],
    ]);
    if (!empty($upd['notUpdated'][$id])) {
        fail(502, 'retry failed: ' . (string)($upd['notUpdated'][$id]['description'] ?? 'unknown error'));
    }
    ok(['retried' => $id]);
}

/* ------------------------------------------------------- deliverability */

function domainDeliverability(string $name): never
{
    $st = db()->prepare('SELECT * FROM domains WHERE domain_name = ?');
    $st->execute([strtolower($name)]);
    $row = $st->fetch();
    if (!$row) {
        fail(404, 'domain not found');
    }
    $domain = $row['domain_name'];
    $records = domainDnsRecords($row);
    $checks = [];
    foreach ($records as $rec) {
        $host = $rec['name'] === '@' ? $domain : $rec['name'] . '.' . $domain;
        $found = null;
        if ($rec['type'] === 'MX') {
            foreach (dns_get_record($domain, DNS_MX) ?: [] as $mx) {
                if (!empty($mx['target'])) {
                    $found = (string)$mx['target'];
                    break;
                }
            }
        } else {
            $needle = str_contains($rec['value'], 'v=DKIM1') ? 'v=DKIM1'
                : (str_contains($rec['value'], 'v=DMARC1') ? 'v=DMARC1' : 'v=spf1');
            foreach (dns_get_record($host, DNS_TXT) ?: [] as $tx) {
                $txt = (string)($tx['txt'] ?? implode('', $tx['entries'] ?? []));
                if (str_contains($txt, $needle)) {
                    $found = $txt;
                    break;
                }
            }
        }
        $checks[] = [
            'type' => $rec['type'], 'name' => $rec['name'], 'host' => $host,
            'expected' => $rec['value'], 'published' => $found !== null, 'found' => $found,
        ];
    }
    $signatures = [];
    if (!empty($row['stalwart_domain_id'])) {
        foreach (stalwartSignaturesForDomain((string)$row['stalwart_domain_id']) as $s) {
            $signatures[] = [
                'id'        => $s['id'] ?? null,
                'selector'  => $s['selector'] ?? null,
                'algorithm' => str_contains((string)($s['@type'] ?? ''), 'Ed25519') ? 'ed25519' : 'rsa',
                'stage'     => $s['stage'] ?? null,
            ];
        }
    }
    ok([
        'domain'          => $domain,
        'records'         => $records,
        'checks'          => $checks,
        'signatures'      => $signatures,
        'catchAllAddress' => stalwartCatchAll($row),
    ]);
}

function domainCatchAll(string $name): never
{
    $st = db()->prepare('SELECT * FROM domains WHERE domain_name = ?');
    $st->execute([strtolower($name)]);
    $row = $st->fetch();
    if (!$row) {
        fail(404, 'domain not found');
    }
    if (empty($row['stalwart_domain_id'])) {
        fail(409, 'domain is not provisioned on the mail server');
    }
    $b = body();
    $email = array_key_exists('email', $b) && $b['email'] !== null
        ? strtolower(trim((string)$b['email'])) : null;
    if ($email !== null) {
        if (!validEmail($email) || !str_ends_with($email, '@' . $row['domain_name'])) {
            fail(400, 'catch-all must be an address on this domain');
        }
        if (stalwartFindAccountByEmail($email) === null) {
            fail(404, 'catch-all mailbox not found on the mail server');
        }
    }
    $res = jmap('x:Domain/set', [
        'accountId' => stalwartAdminAccountId(),
        'update'    => [(string)$row['stalwart_domain_id'] => ['catchAllAddress' => $email]],
    ]);
    if (!empty($res['notUpdated'])) {
        fail(502, 'catch-all update failed');
    }
    ok(['domain' => $row['domain_name'], 'catchAllAddress' => $email]);
}

function domainDkimRotate(string $name): never
{
    $st = db()->prepare('SELECT * FROM domains WHERE domain_name = ?');
    $st->execute([strtolower($name)]);
    $row = $st->fetch();
    if (!$row) {
        fail(404, 'domain not found');
    }
    if (empty($row['stalwart_domain_id'])) {
        fail(409, 'domain is not provisioned on the mail server');
    }
    [$priv, $pub] = dkimKeypair();
    $selector = 'am' . gmdate('ymd') . '-' . substr(bin2hex(random_bytes(2)), 0, 4);
    $res = jmap('x:DkimSignature/set', [
        'accountId' => stalwartAdminAccountId(),
        'create'    => ['s1' => [
            '@type'      => 'Dkim1RsaSha256',
            'domainId'   => (string)$row['stalwart_domain_id'],
            'selector'   => $selector,
            'privateKey' => ['@type' => 'Text', 'secret' => $priv],
        ]],
    ]);
    if (empty($res['created']['s1']['id'])) {
        fail(502, 'signature create failed: ' . json_encode($res['notCreated']['s1'] ?? []));
    }
    db()->prepare('UPDATE domains SET dkim_selector = ?, dkim_private_key = ?, dkim_public_key = ? WHERE id = ?')
        ->execute([$selector, $priv, $pub, $row['id']]);
    ok([
        'domain'   => $row['domain_name'],
        'selector' => $selector,
        'record'   => ['type' => 'TXT', 'name' => $selector . '._domainkey', 'value' => 'v=DKIM1; k=rsa; p=' . $pub],
    ], 201);
}

/* --------------------------------------------------- tracking and logs */

function cleanLogLines(array $lines): array
{
    return array_map(static function (string $l): string {
        $l = preg_replace('/\x1b\[[0-9;]*m/', '', $l) ?? $l;
        return substr($l, 0, 500);
    }, $lines);
}

function mailTrack(): never
{
    $q = trim((string)($_GET['q'] ?? ''));
    $hours = max(1, min(168, (int)($_GET['hours'] ?? 24)));
    if (strlen($q) < 3 || str_contains($q, "\n") || str_contains($q, "\r")) {
        fail(400, 'search text must be at least 3 characters');
    }
    $cmd = 'journalctl -u stalwart --since ' . escapeshellarg("-{$hours} hours")
        . ' --no-pager -o cat 2>/dev/null | grep -F -- ' . escapeshellarg($q) . ' | tail -n 200';
    $out = [];
    exec($cmd, $out);
    ok(['query' => $q, 'hours' => $hours, 'count' => count($out), 'lines' => cleanLogLines($out)]);
}

function systemLogs(): never
{
    $n = max(10, min(200, (int)($_GET['lines'] ?? 50)));
    $out = [];
    exec('journalctl -u stalwart -n ' . $n . ' --no-pager -o cat 2>/dev/null', $out);
    ok(['service' => 'stalwart', 'count' => count($out), 'lines' => cleanLogLines($out)]);
}

/* ------------------------------------------------------------- overview */

function statsOverview(): never
{
    $pdo = db();

    $byDomain = [];
    $rows = $pdo->query('SELECT d.domain_name AS domain, COUNT(m.id) AS mailboxes, COALESCE(SUM(m.quota_used_bytes), 0) AS used_bytes, COALESCE(SUM(m.quota_limit_mb), 0) AS quota_mb FROM domains d LEFT JOIN mailboxes m ON m.domain_id = d.id GROUP BY d.domain_name ORDER BY used_bytes DESC, d.domain_name')->fetchAll();
    foreach ($rows as $r) {
        $byDomain[] = ['domain' => (string)$r['domain'], 'mailboxes' => (int)$r['mailboxes'], 'usedBytes' => (int)$r['used_bytes'], 'quotaMb' => (int)$r['quota_mb']];
    }

    $topMailboxes = [];
    $rows = $pdo->query('SELECT m.email, d.domain_name AS domain, m.quota_used_bytes AS used_bytes, m.quota_limit_mb AS quota_mb FROM mailboxes m JOIN domains d ON d.id = m.domain_id ORDER BY m.quota_used_bytes DESC, m.email LIMIT 5')->fetchAll();
    foreach ($rows as $r) {
        $topMailboxes[] = ['email' => (string)$r['email'], 'domain' => (string)$r['domain'], 'usedBytes' => (int)$r['used_bytes'], 'quotaMb' => (int)$r['quota_mb']];
    }

    $recentMailboxes = [];
    $rows = $pdo->query('SELECT m.email, d.domain_name AS domain, m.created_at FROM mailboxes m JOIN domains d ON d.id = m.domain_id ORDER BY m.created_at DESC LIMIT 5')->fetchAll();
    foreach ($rows as $r) {
        $recentMailboxes[] = ['email' => (string)$r['email'], 'domain' => (string)$r['domain'], 'createdAt' => (string)($r['created_at'] ?? '')];
    }

    $recentDomains = [];
    $rows = $pdo->query('SELECT domain_name, created_at FROM domains ORDER BY created_at DESC LIMIT 3')->fetchAll();
    foreach ($rows as $r) {
        $recentDomains[] = ['domain' => (string)$r['domain_name'], 'createdAt' => (string)($r['created_at'] ?? '')];
    }

    $newMailboxes7d = (int)$pdo->query("SELECT COUNT(*) FROM mailboxes WHERE created_at > now() - interval '7 days'")->fetchColumn();

    $queue = ['count' => 0, 'items' => []];
    try {
        $res = jmap('x:QueuedMessage/get', ['accountId' => stalwartAdminAccountId(), 'ids' => null]);
        $list = $res['list'] ?? [];
        $queue = ['count' => count($list), 'items' => array_slice($list, 0, 5)];
    } catch (Throwable) {
        // Queue unavailable: the rest of the overview still renders.
    }

    $memTotalKb = 0;
    $memAvailKb = 0;
    foreach (file('/proc/meminfo') ?: [] as $line) {
        if (preg_match('/^MemTotal:\s+(\d+)/', $line, $mm)) {
            $memTotalKb = (int)$mm[1];
        }
        if (preg_match('/^MemAvailable:\s+(\d+)/', $line, $mm)) {
            $memAvailKb = (int)$mm[1];
        }
    }
    $uptimeSec = 0;
    $up = @file_get_contents('/proc/uptime');
    if ($up !== false) {
        $uptimeSec = (int)floatval(explode(' ', trim($up))[0]);
    }
    $load = sys_getloadavg() ?: [0.0, 0.0, 0.0];

    $lastBackup = null;
    $bkFiles = glob(rtrim(cfg('BACKUP_DIR', '/var/www/affinmail/backups'), '/') . '/*.sql.gz') ?: [];
    if ($bkFiles !== []) {
        usort($bkFiles, static fn(string $a, string $b): int => (filemtime($b) ?: 0) <=> (filemtime($a) ?: 0));
        $f = $bkFiles[0];
        $lastBackup = ['file' => basename($f), 'sizeBytes' => (int)(filesize($f) ?: 0), 'at' => gmdate('Y-m-d H:i:s', filemtime($f) ?: time())];
    }

    // Time series for the dashboard charts (fed by api/bin/collect-stats.php).
    $history = ['mailDaily' => [], 'queueSeries' => [], 'repSeries' => [], 'uptime24h' => [], 'ips' => []];
    try {
        $mailRows = $pdo->query("SELECT to_char((hour + interval '6 hours')::date, 'YYYY-MM-DD') AS day,
            sum(count) FILTER (WHERE kind = 'queued') AS queued,
            sum(count) FILTER (WHERE kind = 'delivered') AS delivered,
            sum(count) FILTER (WHERE kind = 'failed') AS failed,
            sum(count) FILTER (WHERE kind = 'deferred') AS deferred,
            sum(count) FILTER (WHERE kind = 'spam') AS spam
            FROM stats_mail_events WHERE hour > now() - interval '8 days'
            GROUP BY 1 ORDER BY 1")->fetchAll();
        foreach ($mailRows as $r) {
            $d = (int)($r['delivered'] ?? 0);
            $f = (int)($r['failed'] ?? 0);
            $history['mailDaily'][] = [
                'day' => (string)$r['day'],
                'queued' => (int)($r['queued'] ?? 0),
                'delivered' => $d,
                'failed' => $f,
                'deferred' => (int)($r['deferred'] ?? 0),
                'spam' => (int)($r['spam'] ?? 0),
                'rate' => ($d + $f) > 0 ? round($d / ($d + $f) * 100, 1) : null,
            ];
        }
        $sampleRows = $pdo->query("SELECT to_char(ts, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS ts, queue_count, svc_stalwart, svc_pg, svc_redis
            FROM stats_samples WHERE ts > now() - interval '25 hours' ORDER BY ts")->fetchAll();
        $up = ['stalwart' => [0, 0], 'postgresql' => [0, 0], 'redis' => [0, 0]];
        foreach ($sampleRows as $s) {
            $history['queueSeries'][] = ['ts' => (string)$s['ts'], 'queue' => $s['queue_count'] === null ? null : (int)$s['queue_count'],
                'svc' => [$s['svc_stalwart'] === null ? null : (int)$s['svc_stalwart'], $s['svc_pg'] === null ? null : (int)$s['svc_pg'], $s['svc_redis'] === null ? null : (int)$s['svc_redis']]];
            foreach (['stalwart' => 'svc_stalwart', 'postgresql' => 'svc_pg', 'redis' => 'svc_redis'] as $name => $col) {
                if ($s[$col] !== null) {
                    $up[$name][1]++;
                    if ((int)$s[$col] === 1) {
                        $up[$name][0]++;
                    }
                }
            }
        }
        foreach ($up as $name => [$okN, $tot]) {
            $history['uptime24h'][$name] = $tot > 0 ? round($okN / $tot * 100, 2) : null;
        }
        $repRows = $pdo->query("SELECT to_char(ts, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS ts, rep_score FROM stats_samples
            WHERE ts > now() - interval '7 days' AND rep_score IS NOT NULL ORDER BY ts")->fetchAll();
        $history['repSeries'] = array_map(static fn($r) => ['ts' => (string)$r['ts'], 'score' => (float)$r['rep_score']], $repRows);
        $ipRows = $pdo->query("SELECT host(p.ip_address) AS ip, p.reputation_score AS score, p.is_blacklisted AS blacklisted,
            (SELECT count(*) FROM ip_rbl_checks c WHERE c.ip_id = p.id AND c.is_listed AND c.checked_at > now() - interval '1 hour') AS listed_now,
            (SELECT max(c.checked_at) FROM ip_rbl_checks c WHERE c.ip_id = p.id) AS last_checked
            FROM ip_pools p WHERE p.is_active ORDER BY p.ip_address")->fetchAll();
        $history['ips'] = array_map(static fn($r) => [
            'ip' => (string)$r['ip'],
            'score' => (float)$r['score'],
            'blacklisted' => (bool)$r['blacklisted'],
            'listedNow' => (int)$r['listed_now'],
            'lastChecked' => $r['last_checked'] === null ? null : (string)$r['last_checked'],
        ], $ipRows);
    } catch (Throwable) {
        // Collector tables not created yet — charts render empty until the first run.
    }

    ok([
        'byDomain'        => $byDomain,
        'topMailboxes'    => $topMailboxes,
        'recentMailboxes' => $recentMailboxes,
        'recentDomains'   => $recentDomains,
        'newMailboxes7d'  => $newMailboxes7d,
        'queue'           => $queue,
        'server'          => [
            'diskTotal'  => (int)disk_total_space('/'),
            'diskFree'   => (int)disk_free_space('/'),
            'memTotalKb' => $memTotalKb,
            'memAvailKb' => $memAvailKb,
            'load'       => [round((float)$load[0], 2), round((float)$load[1], 2), round((float)$load[2], 2)],
            'uptimeSec'  => $uptimeSec,
        ],
        'lastBackup'      => $lastBackup,
        'history'         => $history,
    ]);
}

/* ---------------------------------------------------------------- ip pools */

function ipPoolOut(array $r): array
{
    return [
        'id'                => $r['id'],
        'ip_address'        => $r['ip_address'],
        'ip_version'        => (int)$r['ip_version'],
        'pool_type'         => $r['pool_type'],
        'rdns_hostname'     => $r['rdns_hostname'],
        'is_active'         => (bool)$r['is_active'],
        'is_blacklisted'    => (bool)$r['is_blacklisted'],
        'current_allocations' => (int)$r['current_allocations'],
        'max_allocations'   => (int)$r['max_allocations'],
        'reputation_score'  => (float)$r['reputation_score'],
        'createdAt'         => $r['created_at'],
    ];
}

function ipPoolList(): never
{
    $rows = db()->query('SELECT * FROM ip_pools ORDER BY ip_address')->fetchAll();
    ok(['ipPools' => array_map('ipPoolOut', $rows), 'count' => count($rows)]);
}

function ipPoolCreate(): never
{
    $b = body();
    $ip = stringField($b, 'ip_address', 64, false) ?: stringField($b, 'ipAddress', 64, false);
    if ($ip === '' || filter_var($ip, FILTER_VALIDATE_IP) === false) {
        fail(400, 'invalid ip_address');
    }
    $poolType = $b['pool_type'] ?? $b['poolType'] ?? 'shared';
    if (!in_array($poolType, ['shared', 'dedicated'], true)) {
        fail(400, 'pool_type must be shared or dedicated');
    }
    $rdns = stringField($b, 'rdns_hostname', 255, false) ?: stringField($b, 'rdnsHostname', 255, false);
    if ($rdns === '') {
        fail(400, 'rdns_hostname is required');
    }
    $maxAlloc = intField($b, 'max_allocations', 100, 1, 1000000);
    $version = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false ? 6 : 4;

    try {
        $st = db()->prepare(
            'INSERT INTO ip_pools (ip_address, ip_version, pool_type, rdns_hostname, max_allocations)
             VALUES (?, ?, ?, ?, ?) RETURNING *'
        );
        $st->execute([$ip, $version, $poolType, $rdns, $maxAlloc]);
    } catch (PDOException $e) {
        fail(409, 'ip pool entry conflict: ' . $e->getMessage());
    }
    ok(ipPoolOut($st->fetch()), 201);
}

function ipPoolAssign(): never
{
    $b = body();
    $domainName = strtolower(stringField($b, 'domain'));
    $ip = stringField($b, 'ip_address', 64, false) ?: stringField($b, 'ipAddress', 64, false);

    $pdo = db();
    $ipSt = $pdo->prepare('SELECT * FROM ip_pools WHERE ip_address = ?');
    $ipSt->execute([$ip]);
    $pool = $ipSt->fetch();
    if (!$pool) {
        fail(404, 'ip pool entry not found');
    }
    $dSt = $pdo->prepare('SELECT * FROM domains WHERE domain_name = ?');
    $dSt->execute([$domainName]);
    $domain = $dSt->fetch();
    if (!$domain) {
        fail(404, 'domain not found');
    }

    $pdo->prepare('UPDATE domains SET assigned_ip_id = ?, is_dedicated_ip = ?::boolean, updated_at = NOW() WHERE id = ?')
        ->execute([$pool['id'], $pool['pool_type'] === 'dedicated' ? 'true' : 'false', $domain['id']]);
    $pdo->prepare('UPDATE ip_pools SET current_allocations = current_allocations + 1, updated_at = NOW() WHERE id = ?')
        ->execute([$pool['id']]);

    ok([
        'domain'     => $domainName,
        'ipAddress'  => $pool['ip_address'],
        'ipPoolId'   => $pool['id'],
        'poolType'   => $pool['pool_type'],
        'rdnsHostname' => $pool['rdns_hostname'],
    ]);
}

/* ---------------------------------------------------------------- storage */

function storageStatus(): never
{
    $path = cfg('STORAGE_LOCAL_PATH', '/var/www/affinmail/data/blobs');
    $used = 0;
    if (is_dir($path)) {
        $out = [];
        $rc = 0;
        exec('du -sb ' . escapeshellarg($path) . ' 2>/dev/null', $out, $rc);
        if ($rc === 0 && isset($out[0])) {
            $used = (int)strtok($out[0], "\t ");
        }
    }
    $total = @disk_total_space($path);
    $free  = @disk_free_space($path);
    ok([
        'storage_type' => 'fs',
        'local_path'   => $path,
        'used_bytes'   => $used,
        'total_bytes'  => $total === false ? 0 : (int)$total,
        'free_bytes'   => $free === false ? 0 : (int)$free,
    ]);
}

/* ---------------------------------------------------------------- backup */

function backupCreate(): never
{
    $dir = cfg('BACKUP_DIR', '/var/www/affinmail/backups');
    if (!is_dir($dir) && !@mkdir($dir, 0750, true)) {
        fail(500, 'backup directory unavailable');
    }
    $file = $dir . '/affinmail-' . gmdate('Ymd-His') . '.sql.gz';

    // ponytail: PGPASSWORD passed via environment (not argv) so it never shows in ps output.
    putenv('PGPASSWORD=' . cfg('DB_PASSWORD'));

    $cmd = sprintf(
        'pg_dump -h %s -p %s -U %s -d %s --no-owner --no-privileges | gzip -9 > %s',
        escapeshellarg(cfg('DB_HOST', '127.0.0.1')),
        escapeshellarg(cfg('DB_PORT', '5432')),
        escapeshellarg(cfg('DB_USER')),
        escapeshellarg(cfg('DB_NAME', 'affinmail')),
        escapeshellarg($file)
    );
    $out = [];
    $rc = 0;
    exec($cmd, $out, $rc);
    putenv('PGPASSWORD');

    clearstatcache(true, $file);
    $size = is_file($file) ? (int)filesize($file) : 0;
    if ($rc !== 0 || $size <= 0) {
        @unlink($file);
        fail(500, 'pg_dump failed');
    }
    ok(['file' => basename($file), 'path' => $file, 'size_bytes' => $size]);
}

/* ---------------------------------------------------------------- system */

function systemRestart(): never
{
    // ponytail: detached systemd-run so the HTTP response returns before Stalwart stops.
    exec('systemd-run --on-active=2 /usr/bin/systemctl restart stalwart.service >/dev/null 2>&1 &');
    ok(['restarting' => 'stalwart.service']);
}


/* ------------------------------------------------- admin panel auth */

function adminLoginRateLimit(): void
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    try {
        $n = (int)redis()->get('auth:login:count:' . $ip);
    } catch (Throwable) {
        return;
    }
    if ($n >= 10) {
        fail(429, 'too many login attempts - try again in a few minutes');
    }
}

function adminLoginBump(): void
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    try {
        $r = redis();
        $k = 'auth:login:count:' . $ip;
        $n = (int)$r->incr($k);
        if ($n === 1) {
            $r->expire($k, 300);
        }
    } catch (Throwable) {
    }
}

/**
 * Panel sign-in with the mail server's own administrator (root) credentials.
 * Credentials are verified against Stalwart itself and the account must carry
 * the Admin role - there is no separate panel account. Returns an opaque
 * session token (12 h) that authenticate() also accepts.
 */
function adminLogin(): never
{
    adminLoginRateLimit();
    $b = body();
    $username = trim(stringField($b, 'username', 255));
    $password = stringField($b, 'password', 1024);
    if ($username === '' || $password === '') {
        fail(400, 'username and password are required');
    }

    // WHM-style root sign-in: "root" is the operating system's root user.
    // The password is verified against /etc/shadow itself, so the panel
    // root password is always the server root password - there is no
    // separate panel credential to remember or drift. (This API service
    // runs as root, so it can read the shadow file; the password is used
    // only inside this check and is never stored or logged.)
    if (strcasecmp($username, 'root') === 0) {
        $hash = '';
        foreach (file('/etc/shadow', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $parts = explode(':', $line);
            if (($parts[0] ?? '') === 'root') {
                $hash = (string)($parts[1] ?? '');
                break;
            }
        }
        $okPw = $hash !== '' && !str_starts_with($hash, '!') && !str_starts_with($hash, '*')
            && hash_equals($hash, crypt($password, $hash));
        if (!$okPw) {
            adminLoginBump();
            fail(401, 'invalid credentials');
        }
        $token = bin2hex(random_bytes(32));
        try {
            redis()->setex('auth:session:' . hash('sha256', $token), 43200, 'root');
        } catch (Throwable) {
            fail(500, 'session store unavailable');
        }
        ok(['token' => $token, 'username' => 'root', 'expiresInSeconds' => 43200]);
    }

    // Stalwart accounts sign in with their full email address; the server
    // administrator may type the bare name ("admin") - resolve it to the
    // matching account's email address first.
    $loginId = $username;
    if (!str_contains($loginId, '@')) {
        foreach (stalwartAccounts() as $a) {
            if (strcasecmp((string)($a['name'] ?? ''), $loginId) === 0 && ($a['emailAddress'] ?? '') !== '') {
                $loginId = (string)$a['emailAddress'];
                break;
            }
        }
    }

    $ch = curl_init(cfg('STALWART_URL', 'http://127.0.0.1:8080') . '/jmap/session');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_USERPWD        => $loginId . ':' . $password,
    ]);
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($raw === false || $code !== 200) {
        adminLoginBump();
        fail(401, 'invalid credentials');
    }
    $d = json_decode($raw, true);
    $acctId = is_array($d) ? (string)(array_key_first($d['accounts'] ?? []) ?? '') : '';
    $sessionUser = is_array($d) ? (string)($d['username'] ?? $username) : $username;

    $account = $acctId !== '' ? stalwartAccountById($acctId) : null;
    if ($account === null || (($account['roles']['@type'] ?? '') !== 'Admin')) {
        fail(403, 'this sign-in is for the server administrator account only');
    }

    $token = bin2hex(random_bytes(32));
    try {
        redis()->setex('auth:session:' . hash('sha256', $token), 43200, $sessionUser);
    } catch (Throwable) {
        fail(500, 'session store unavailable');
    }
    ok(['token' => $token, 'username' => $sessionUser, 'expiresInSeconds' => 43200]);
}

function adminLogout(): never
{
    $given = bearer();
    if ($given !== '') {
        try {
            redis()->del('auth:session:' . hash('sha256', $given));
        } catch (Throwable) {
        }
    }
    ok(['signedOut' => true]);
}

/** Remove expired one-time SSO credentials from Stalwart accounts. */
function sweepTempCredentials(): void
{
    try {
        $all = redis()->hGetAll('auth:sso:tempcreds');
    } catch (Throwable) {
        return;
    }
    if (!is_array($all)) {
        return;
    }
    $now = time();
    foreach ($all as $k => $exp) {
        if ((int)$exp > $now) {
            continue;
        }
        $parts = explode(':', (string)$k, 2);
        if (count($parts) === 2 && $parts[0] !== '' && $parts[1] !== '') {
            try {
                stalwartSetAccount(['update' => [$parts[0] => ['credentials/' . $parts[1] => null]]]);
            } catch (Throwable) {
            }
        }
        try {
            redis()->hDel('auth:sso:tempcreds', (string)$k);
        } catch (Throwable) {
        }
    }
}

/**
 * Exchange a one-time SSO token (from POST /auth/sso-token) for a temporary
 * mailbox credential. The token is consumed atomically; the credential is an
 * extra credential on the account and is swept after 5 minutes.
 */
function ssoExchange(): never
{
    sweepTempCredentials();
    $b = body();
    $token = stringField($b, 'token', 128);
    $email = null;
    try {
        $val = redis()->eval(
            "local v = redis.call('get', KEYS[1]); if v then redis.call('del', KEYS[1]); end; return v",
            ['auth:sso:token:' . $token],
            1
        );
        $email = is_string($val) ? $val : null;
    } catch (Throwable) {
        try {
            $r = redis();
            $v = $r->get('auth:sso:token:' . $token);
            if (is_string($v) && $v !== '') {
                $r->del('auth:sso:token:' . $token);
                $email = $v;
            }
        } catch (Throwable) {
            fail(500, 'token store unavailable');
        }
    }
    if (!is_string($email) || $email === '') {
        fail(401, 'invalid or expired sso token');
    }
    $acct = stalwartFindAccountByEmail($email);
    if ($acct === null) {
        fail(404, 'mailbox not found');
    }
    $accountId = (string)$acct['id'];

    // Stalwart allows exactly ONE password credential per account, so the
    // mailbox's real password is resolved server-side instead of issuing a
    // temporary one: API-provisioned mailboxes keep it in the vault; for any
    // other mailbox the admin API's own configured credential is used when
    // the target is the server admin account itself.
    $password = null;
    $st = db()->prepare('SELECT secret_vault FROM mailboxes WHERE email = ?');
    $st->execute([$email]);
    $vault = $st->fetchColumn();
    if (is_string($vault) && $vault !== '') {
        try {
            $password = vaultDecrypt($vault);
        } catch (Throwable) {
            $password = null;
        }
    }
    if ($password === null && (($acct['roles']['@type'] ?? '') === 'Admin')) {
        // The server administrator account: the API's configured credential
        // is this account's own password.
        $password = (string)cfg('STALWART_ADMIN_PASSWORD');
    }
    if ($password === null || $password === '') {
        fail(409, 'mailbox password is not held by the admin API (mailbox was not provisioned through the API) - reset its password from the panel to enable SSO');
    }
    ok(['email' => $email, 'password' => $password]);
}

/** Set a new password for a mailbox (Stalwart + billing mirror when present). */
function mailboxPassword(string $email): never
{
    $b = body();
    $password = stringField($b, 'password', 256);
    if (strlen($password) < 8) {
        fail(400, 'password must be 8-256 characters');
    }
    $email = strtolower($email);
    $acct = stalwartFindAccountByEmail($email);
    $st = db()->prepare('SELECT * FROM mailboxes WHERE email = ?');
    $st->execute([$email]);
    $row = $st->fetch();
    if ($acct === null && !$row) {
        fail(404, 'mailbox not found');
    }
    try {
        if ($acct !== null) {
            stalwartSetPassword((string)$acct['id'], $password);
        }
    } catch (RuntimeException $e) {
        fail(502, 'stalwart update failed: ' . $e->getMessage());
    }
    if ($row) {
        db()->prepare('UPDATE mailboxes SET password_hash = ?, secret_vault = ?, updated_at = NOW() WHERE id = ?')
            ->execute([password_hash($password, PASSWORD_ARGON2ID), vaultEncrypt($password), $row['id']]);
        $st2 = db()->prepare('SELECT m.*, d.domain_name FROM mailboxes m JOIN domains d ON d.id = m.domain_id WHERE m.id = ?');
        $st2->execute([$row['id']]);
        $fresh = $st2->fetch();
        if ($fresh) {
            ok(mailboxOut($fresh));
        }
    }
    ok(['email' => $email, 'passwordUpdated' => true]);
}

/* ---------------------------------------------------------------- sso */

function ssoToken(): never
{
    $b = body();
    $email = strtolower(stringField($b, 'email'));
    if (!validEmail($email)) {
        fail(400, 'invalid email address');
    }
    $ttl = intField($b, 'ttlSeconds', 120, 30, 86400);

    if (stalwartFindAccountByEmail($email) === null) {
        fail(404, 'mailbox not found');
    }

    $token = bin2hex(random_bytes(24));
    try {
        redis()->setex('auth:sso:token:' . $token, $ttl, $email);
    } catch (Throwable $e) {
        fail(500, 'token store unavailable');
    }

    ok([
        'ssoUrl'    => 'https://affinmail.hostaffin.com/sso?token=' . $token,
        'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', time() + $ttl),
    ]);
}

/* ---------------------------------------------------------------- health */

function healthCheck(): never
{
    $checks = ['postgres' => false, 'redis' => false, 'stalwart' => false];

    try {
        db()->query('SELECT 1');
        $checks['postgres'] = true;
    } catch (Throwable) {
    }

    try {
        $checks['redis'] = (bool)redis()->ping();
    } catch (Throwable) {
    }

    try {
        $ch = curl_init(cfg('STALWART_URL', 'http://127.0.0.1:8080') . '/jmap/session');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 5,
            CURLOPT_USERPWD        => cfg('STALWART_ADMIN_USER') . ':' . cfg('STALWART_ADMIN_PASSWORD'),
        ]);
        curl_exec($ch);
        $checks['stalwart'] = curl_getinfo($ch, CURLINFO_HTTP_CODE) === 200;
        curl_close($ch);
    } catch (Throwable) {
    }

    respond(200, [
        'status' => 'success',
        'data'   => [
            'service' => 'affinmail-api',
            'version' => API_VERSION,
            'checks'  => $checks,
        ],
    ]);
}

/* ---------------------------------------------------------------- import: job storage */

function ensureImportTables(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    db()->exec(
        "CREATE TABLE IF NOT EXISTS import_jobs (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            target_email VARCHAR(255) NOT NULL,
            target_folder TEXT,
            status TEXT NOT NULL DEFAULT 'running',
            total INTEGER NOT NULL DEFAULT 0,
            imported INTEGER NOT NULL DEFAULT 0,
            skipped_duplicates INTEGER NOT NULL DEFAULT 0,
            errors JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            finished_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_import_jobs_target ON import_jobs(target_email, created_at DESC);
        CREATE TABLE IF NOT EXISTS imported_messages (
            target_email VARCHAR(255) NOT NULL,
            message_id TEXT NOT NULL,
            email_id TEXT,
            imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (target_email, message_id)
        )"
    );
    $done = true;
}

function importJobOut(array $r): array
{
    return [
        'id'                => (string)$r['id'],
        'type'              => (string)$r['type'],
        'status'            => (string)$r['status'],
        'targetEmail'       => (string)$r['target_email'],
        'targetFolder'      => $r['target_folder'] === null ? null : (string)$r['target_folder'],
        'total'             => (int)$r['total'],
        'imported'          => (int)$r['imported'],
        'skippedDuplicates' => (int)$r['skipped_duplicates'],
        'errors'            => is_array($r['errors'] ?? null) ? $r['errors'] : (json_decode((string)($r['errors'] ?? '[]'), true) ?: []),
        'createdAt'         => $r['created_at'],
        'finishedAt'        => $r['finished_at'],
    ];
}

function importUuid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

/* ---------------------------------------------------------------- import: JMAP as user */

function userSession(string $email, string $password): array
{
    static $cache = [];
    $key = strtolower($email);
    if (isset($cache[$key])) {
        return $cache[$key];
    }

    $ch = curl_init(cfg('STALWART_URL', 'http://127.0.0.1:8080') . '/jmap/session');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_USERPWD        => $email . ':' . $password,
    ]);
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($raw === false || $code !== 200) {
        throw new RuntimeException('target mailbox authentication failed (http ' . $code . ')' . ($err !== '' ? ': ' . $err : ''));
    }
    $d = json_decode($raw, true);
    $acct = $d['primaryAccounts']['urn:ietf:params:jmap:mail'] ?? array_key_first($d['accounts'] ?? []);
    if (!is_string($acct) || $acct === '') {
        throw new RuntimeException('target mailbox session has no mail account');
    }
    return $cache[$key] = ['accountId' => $acct, 'session' => $d];
}

function jmapAsUser(string $email, string $password, string $method, array $args): array
{
    $payload = json_encode([
        'using'       => ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail', 'urn:stalwart:jmap'],
        'methodCalls' => [[$method, $args, 'c1']],
    ], JSON_UNESCAPED_SLASHES);

    $ch = curl_init(cfg('STALWART_URL', 'http://127.0.0.1:8080') . '/jmap');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_USERPWD        => $email . ':' . $password,
    ]);
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($raw === false || $code !== 200) {
        throw new RuntimeException('jmap ' . $method . ' failed (http ' . $code . ')' . ($err !== '' ? ': ' . $err : ''));
    }
    $d = json_decode($raw, true);
    if (!is_array($d) || !isset($d['methodResponses'][0])) {
        throw new RuntimeException('jmap ' . $method . ' returned malformed response');
    }
    [$name, $res] = [$d['methodResponses'][0][0], $d['methodResponses'][0][1]];
    if ($name === 'error') {
        throw new RuntimeException('jmap ' . ($res['type'] ?? 'error') . ': ' . ($res['description'] ?? 'request failed'));
    }
    return $res;
}

function userUploadBlob(string $email, string $password, string $accountId, string $raw): string
{
    $ch = curl_init(cfg('STALWART_URL', 'http://127.0.0.1:8080') . '/jmap/upload/' . rawurlencode($accountId) . '/');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $raw,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 120,
        CURLOPT_HTTPHEADER     => ['Content-Type: message/rfc822'],
        CURLOPT_USERPWD        => $email . ':' . $password,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($body === false || $code < 200 || $code >= 300) {
        throw new RuntimeException('blob upload failed (http ' . $code . ')' . ($err !== '' ? ': ' . $err : ''));
    }
    $d = json_decode($body, true);
    $blobId = $d['blobId'] ?? null;
    if (!is_string($blobId) || $blobId === '') {
        throw new RuntimeException('blob upload returned no blobId');
    }
    return $blobId;
}

function userMailboxId(string $email, string $password, string $accountId, string $folder): string
{
    $res = jmapAsUser($email, $password, 'Mailbox/get', ['accountId' => $accountId, 'ids' => null]);
    $list = $res['list'] ?? [];

    foreach ($list as $mb) {
        $role = (string)($mb['role'] ?? '');
        $name = (string)($mb['name'] ?? '');
        if ($folder === '' ? $role === 'inbox' : strcasecmp($name, $folder) === 0) {
            return (string)$mb['id'];
        }
    }
    if ($folder === '') {
        foreach ($list as $mb) {
            if (($mb['role'] ?? null) === 'inbox') {
                return (string)$mb['id'];
            }
        }
        if ($list !== []) {
            return (string)$list[0]['id'];
        }
        throw new RuntimeException('target mailbox has no folders');
    }

    $set = jmapAsUser($email, $password, 'Mailbox/set', [
        'accountId' => $accountId,
        'create'    => ['n1' => ['name' => $folder]],
    ]);
    $id = $set['created']['n1']['id'] ?? null;
    if (!is_string($id) || $id === '') {
        throw new RuntimeException('could not create target folder: ' . json_encode($set['notCreated'] ?? [], JSON_UNESCAPED_SLASHES));
    }
    return $id;
}

function importOneMessage(
    string $email,
    string $password,
    string $accountId,
    string $mailboxId,
    string $raw,
    array $keywords,
    string $receivedAt
): string {
    $blobId = userUploadBlob($email, $password, $accountId, $raw);
    $res = jmapAsUser($email, $password, 'Email/import', [
        'accountId' => $accountId,
        'emails'    => ['i1' => [
            'blobId'     => $blobId,
            'mailboxIds' => [$mailboxId => true],
            'keywords'   => (object)$keywords,
            'receivedAt' => $receivedAt,
        ]],
    ]);
    $id = $res['created']['i1']['id'] ?? null;
    if (!is_string($id) || $id === '') {
        throw new RuntimeException('email import rejected: ' . json_encode($res['notCreated'] ?? $res, JSON_UNESCAPED_SLASHES));
    }
    return $id;
}

/* ---------------------------------------------------------------- import: parsing */

function messageHeaders(string $raw): array
{
    $crlf = strpos($raw, "\r\n\r\n");
    $lf = strpos($raw, "\n\n");
    if ($lf !== false && ($crlf === false || $lf < $crlf)) {
        $pos = $lf;
    } else {
        $pos = $crlf === false ? strlen($raw) : $crlf;
    }
    $block = substr($raw, 0, $pos);
    $block = preg_replace("/\r?\n[ \t]+/", ' ', $block) ?? $block;

    $out = [];
    foreach (preg_split("/\r?\n/", $block) ?: [] as $line) {
        if (!str_contains($line, ':')) {
            continue;
        }
        [$k, $v] = explode(':', $line, 2);
        $k = strtolower(trim($k));
        if ($k === '') {
            continue;
        }
        $out[$k] = isset($out[$k]) ? $out[$k] . ', ' . trim($v) : trim($v);
    }
    return $out;
}

function messageIdOf(array $headers): string
{
    $v = trim((string)($headers['message-id'] ?? ''));
    if ($v === '') {
        return '';
    }
    return preg_match('/<([^>]+)>/', $v, $m) === 1 ? trim($m[1]) : $v;
}

function isoFromDate(?string $date, ?int $fallback = null): string
{
    if (is_string($date) && $date !== '') {
        $ts = strtotime($date);
        if ($ts !== false) {
            return gmdate('Y-m-d\TH:i:s\Z', $ts);
        }
    }
    return gmdate('Y-m-d\TH:i:s\Z', $fallback ?? time());
}

/** mbox Status/X-Status -> JMAP keywords. */
function mboxKeywords(array $headers): array
{
    $kw = [];
    $status = strtoupper((string)($headers['status'] ?? ''));
    if (str_contains($status, 'R')) {
        $kw['$seen'] = true;
    }
    $xs = strtoupper((string)($headers['x-status'] ?? ''));
    if (str_contains($xs, 'A')) {
        $kw['$answered'] = true;
    }
    if (str_contains($xs, 'F')) {
        $kw['$flagged'] = true;
    }
    if (str_contains($xs, 'D')) {
        $kw['$draft'] = true;
    }
    return $kw;
}

function imapKeywords(string $flags): array
{
    $kw = [];
    if (stripos($flags, '\Seen') !== false) {
        $kw['$seen'] = true;
    }
    if (stripos($flags, '\Flagged') !== false) {
        $kw['$flagged'] = true;
    }
    if (stripos($flags, '\Answered') !== false) {
        $kw['$answered'] = true;
    }
    if (stripos($flags, '\Draft') !== false) {
        $kw['$draft'] = true;
    }
    return $kw;
}

function looksLikeMbox(string $raw): bool
{
    return preg_match('/^From \S+ (Mon|Tue|Wed|Thu|Fri|Sat|Sun) /m', $raw) === 1;
}

function parseMbox(string $raw): array
{
    $norm = str_replace("\r\n", "\n", $raw);
    $messages = [];
    $cur = [];
    $fromDate = null;

    // Strict "From sender Day Mon DD HH:MM:SS YYYY"; fall back to any "From " boundary
    // for writers that use a non-standard separator date.
    $strict = '/^From \S+ (?:\w{3} )?\w{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}/';
    $boundary = preg_match($strict . 'm', $norm) === 1 ? $strict : '/^From \S+ /';

    $push = static function () use (&$messages, &$cur, &$fromDate): void {
        $body = implode("\n", $cur);
        if (trim($body) !== '') {
            $messages[] = ['raw' => $body . "\n", 'keywords' => null, 'receivedAt' => null, 'fromDate' => $fromDate];
        }
        $cur = [];
    };

    foreach (explode("\n", $norm) as $line) {
        if (str_starts_with($line, 'From ') && preg_match($boundary, $line) === 1) {
            $push();
            $ts = strtotime(substr($line, 5));
            $fromDate = $ts === false ? null : $ts;
            continue;
        }
        // mboxrd unescape: ">From " -> "From ", ">>From " -> ">From "
        if (preg_match('/^>+From /', $line) === 1) {
            $line = substr($line, 1);
        }
        $cur[] = $line;
    }
    $push();
    return $messages;
}

/* ---------------------------------------------------------------- import: raw IMAP client */

final class ImapClient
{
    /** @var resource */
    private $sock;
    private int $seq = 0;

    public function __construct(string $host, int $port, bool $ssl, bool $starttls = false, int $timeout = 30)
    {
        $verify = cfg('IMPORT_IMAP_INSECURE') === '1' ? false : true;
        $ctx = stream_context_create(['ssl' => [
            'verify_peer'       => $verify,
            'verify_peer_name'  => $verify,
            'SNI_enabled'       => true,
        ]]);
        $scheme = $ssl ? 'ssl' : 'tcp';
        $lastError = null;
        set_error_handler(static function (int $no, string $str) use (&$lastError): bool {
            $lastError = $str;
            return true;
        });
        try {
            $sock = stream_socket_client(
                $scheme . '://' . $host . ':' . $port,
                $errno,
                $errstr,
                $timeout,
                STREAM_CLIENT_CONNECT,
                $ctx
            );
        } finally {
            restore_error_handler();
        }
        if (!is_resource($sock)) {
            $why = $errstr !== '' ? $errstr : ($lastError ?? 'connection refused or TLS handshake failed');
            throw new RuntimeException('IMAP connect to ' . $host . ':' . $port . ' failed: ' . $why
                . ($ssl ? ' (if the server uses a self-signed certificate, set IMPORT_IMAP_INSECURE=1)' : ''));
        }
        stream_set_timeout($sock, $timeout);
        $this->sock = $sock;

        $greet = $this->readLine();
        if (preg_match('/^\* (OK|PREAUTH)\b/i', $greet) !== 1) {
            throw new RuntimeException('IMAP server rejected connection: ' . trim($greet));
        }
        if ($starttls) {
            [$raw, $ok] = $this->command('STARTTLS');
            if (!$ok) {
                throw new RuntimeException('IMAP STARTTLS failed: ' . self::lastLine($raw));
            }
            if (!stream_socket_enable_crypto($this->sock, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new RuntimeException('IMAP STARTTLS negotiation failed');
            }
        }
    }

    public function login(string $user, string $password): void
    {
        [$raw, $ok] = $this->command('LOGIN ' . self::quote($user) . ' ' . self::quote($password));
        if (!$ok) {
            throw new RuntimeException('IMAP login failed: ' . self::lastLine($raw));
        }
    }

    public function fetchAll(string $folder, int $limit = 0): array
    {
        [$raw, $ok] = $this->command('SELECT ' . self::quote($folder));
        if (!$ok) {
            throw new RuntimeException('IMAP folder open failed: ' . self::lastLine($raw));
        }
        [$raw, $ok] = $this->command('FETCH 1:* (FLAGS INTERNALDATE BODY.PEEK[])');
        if (!$ok) {
            throw new RuntimeException('IMAP fetch failed: ' . self::lastLine($raw));
        }
        $messages = self::parseFetch($raw);
        if ($limit > 0 && count($messages) > $limit) {
            $messages = array_slice($messages, 0, $limit);
        }
        return $messages;
    }

    public function logout(): void
    {
        try {
            $this->command('LOGOUT');
        } catch (Throwable) {
        }
        if (is_resource($this->sock)) {
            @fclose($this->sock);
        }
    }

    private static function quote(string $s): string
    {
        return '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $s) . '"';
    }

    private static function lastLine(string $raw): string
    {
        $lines = preg_split('/\r?\n/', trim($raw)) ?: [];
        return (string)($lines === [] ? '' : end($lines));
    }

    private function readLine(): string
    {
        $line = fgets($this->sock);
        if ($line === false) {
            throw new RuntimeException('IMAP connection closed unexpectedly');
        }
        return $line;
    }

    /** @return array{0:string,1:bool} raw response text + tagged OK flag */
    private function command(string $cmd): array
    {
        $tag = 'A' . (++$this->seq);
        if (fwrite($this->sock, $tag . ' ' . $cmd . "\r\n") === false) {
            throw new RuntimeException('IMAP write failed');
        }
        $raw = '';
        while (true) {
            $line = $this->readLine();
            $raw .= $line;
            if (preg_match('/\{(\d+)\}\r\n$/', $line, $m) === 1) {
                $need = (int)$m[1];
                $lit = '';
                while (strlen($lit) < $need) {
                    $chunk = fread($this->sock, $need - strlen($lit));
                    if ($chunk === false || $chunk === '') {
                        throw new RuntimeException('IMAP literal read failed');
                    }
                    $lit .= $chunk;
                }
                $raw .= $lit;
                continue;
            }
            if (str_starts_with($line, $tag . ' ')) {
                return [$raw, preg_match('/^' . preg_quote($tag, '/') . ' OK\b/i', $line) === 1];
            }
        }
    }

    private static function findFetchStart(string $raw, int $offset): ?int
    {
        return preg_match('/\* \d+ FETCH \(/i', $raw, $m, PREG_OFFSET_CAPTURE, $offset) === 1 ? $m[0][1] : null;
    }

    private static function parseFetch(string $raw): array
    {
        $messages = [];
        $pos = 0;
        $len = strlen($raw);

        while ($pos < $len && ($start = self::findFetchStart($raw, $pos)) !== null) {
            if (preg_match('/BODY\[\] \{(\d+)\}\r?\n/i', $raw, $bm, PREG_OFFSET_CAPTURE, $start) !== 1) {
                $pos = $start + 1;
                continue;
            }
            $bodyStart = $bm[0][1] + strlen($bm[0][0]);
            $bodyLen = (int)$bm[1][0];
            $head = substr($raw, $start, $bm[0][1] - $start);
            $body = substr($raw, $bodyStart, $bodyLen);

            $flags = '';
            if (preg_match('/FLAGS \(([^)]*)\)/i', $head, $fm) === 1) {
                $flags = $fm[1];
            }
            $receivedAt = null;
            if (preg_match('/INTERNALDATE "([^"]*)"/i', $head, $im) === 1) {
                foreach (['j-M-Y H:i:s O', 'd-M-Y H:i:s O'] as $fmt) {
                    $dt = DateTime::createFromFormat($fmt, $im[1]);
                    if ($dt !== false) {
                        $receivedAt = $dt->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
                        break;
                    }
                }
            }

            if ($body !== '') {
                $messages[] = [
                    'raw'        => $body,
                    'keywords'   => imapKeywords($flags),
                    'receivedAt' => $receivedAt,
                    'fromDate'   => null,
                ];
            }
            $pos = $bodyStart + $bodyLen;
        }
        return $messages;
    }
}

/* ---------------------------------------------------------------- import: job runner */

function importRemember(string $targetEmail, string $messageId, ?string $emailId): void
{
    static $st = null;
    $st ??= db()->prepare(
        'INSERT INTO imported_messages (target_email, message_id, email_id) VALUES (?, ?, ?)
         ON CONFLICT (target_email, message_id) DO NOTHING'
    );
    $st->execute([strtolower($targetEmail), $messageId, $emailId]);
}

function importRun(string $type, string $targetEmail, string $targetFolder, string $targetPassword, array $messages): never
{
    ensureImportTables();
    $targetEmail = strtolower(trim($targetEmail));
    $targetFolder = trim($targetFolder);

    if (!validEmail($targetEmail)) {
        fail(400, 'field targetEmail must be a valid email address');
    }
    $ident = $GLOBALS['import_identity'] ?? ['kind' => 'admin', 'username' => null];
    if ($ident['kind'] === 'user' && strcasecmp((string)$ident['username'], $targetEmail) !== 0) {
        fail(403, 'targetEmail must match the authenticated user');
    }
    if ($messages === []) {
        fail(400, 'no messages found to import');
    }
    if (count($messages) > 10000) {
        fail(400, 'import exceeds 10000 messages');
    }

    $password = $targetPassword;
    if ($password === '') {
        $st = db()->prepare('SELECT secret_vault FROM mailboxes WHERE email = ?');
        $st->execute([$targetEmail]);
        $vault = $st->fetchColumn();
        if (!is_string($vault) || $vault === '') {
            fail(400, 'target mailbox not found in AffinMail or has no stored password; supply targetPassword');
        }
        try {
            $password = vaultDecrypt($vault);
        } catch (Throwable $e) {
            fail(400, 'stored target password could not be decrypted: ' . $e->getMessage());
        }
    }

    try {
        $session = userSession($targetEmail, $password);
        $accountId = (string)$session['accountId'];
        $mailboxId = userMailboxId($targetEmail, $password, $accountId, $targetFolder);
    } catch (RuntimeException $e) {
        fail(400, $e->getMessage());
    }

    $pdo = db();
    $jobId = importUuid();
    $pdo->prepare(
        'INSERT INTO import_jobs (id, type, target_email, target_folder, status, total)
         VALUES (?, ?, ?, ?, ?, ?)'
    )->execute([$jobId, $type, $targetEmail, $targetFolder === '' ? null : $targetFolder, 'running', count($messages)]);

    $imported = 0;
    $skipped = 0;
    $errors = [];
    $seen = [];
    $maxMessage = 25 * 1024 * 1024;

    try {
        foreach ($messages as $m) {
            $raw = (string)($m['raw'] ?? '');
            if ($raw === '') {
                continue;
            }
            $headers = messageHeaders($raw);
            $mid = messageIdOf($headers);
            $key = $mid !== '' ? $mid : 'sha256:' . hash('sha256', $raw);

            if (strlen($raw) > $maxMessage) {
                $errors[] = ['messageId' => $key, 'error' => 'message exceeds 25MB limit'];
                continue;
            }
            if (isset($seen[$key])) {
                $skipped++;
                continue;
            }
            $seen[$key] = true;

            $st = $pdo->prepare('SELECT 1 FROM imported_messages WHERE target_email = ? AND message_id = ?');
            $st->execute([$targetEmail, $key]);
            if ($st->fetchColumn()) {
                $skipped++;
                continue;
            }

            if ($mid !== '') {
                try {
                    $q = jmapAsUser($targetEmail, $password, 'Email/query', [
                        'accountId' => $accountId,
                        'filter'    => ['header' => ['Message-ID', '<' . $mid . '>']],
                        'limit'     => 1,
                    ]);
                    if (($q['ids'] ?? []) !== []) {
                        $skipped++;
                        importRemember($targetEmail, $key, null);
                        continue;
                    }
                } catch (Throwable) {
                    // best effort: server may not support header filters
                }
            }

            $receivedAt = $m['receivedAt']
                ?? isoFromDate($headers['date'] ?? null, $m['fromDate'] ?? null);
            $keywords = $m['keywords'] ?? mboxKeywords($headers);

            try {
                $emailId = importOneMessage($targetEmail, $password, $accountId, $mailboxId, $raw, $keywords, $receivedAt);
                $imported++;
                importRemember($targetEmail, $key, $emailId);
            } catch (Throwable $e) {
                $errors[] = ['messageId' => $key, 'error' => $e->getMessage()];
            }
        }
    } catch (Throwable $e) {
        $pdo->prepare('UPDATE import_jobs SET status = ?, errors = ?::jsonb, finished_at = NOW() WHERE id = ?')
            ->execute(['failed', json_encode([['messageId' => '', 'error' => $e->getMessage()]], JSON_UNESCAPED_SLASHES), $jobId]);
        fail(500, $e->getMessage());
    }

    $pdo->prepare(
        'UPDATE import_jobs SET status = ?, imported = ?, skipped_duplicates = ?, errors = ?::jsonb, finished_at = NOW()
         WHERE id = ?'
    )->execute(['completed', $imported, $skipped, json_encode($errors, JSON_UNESCAPED_SLASHES), $jobId]);

    $st = $pdo->prepare('SELECT * FROM import_jobs WHERE id = ?');
    $st->execute([$jobId]);
    $row = $st->fetch();
    if (!is_array($row)) {
        fail(500, 'import job disappeared');
    }
    ok(importJobOut($row), 201);
}

/* ---------------------------------------------------------------- import: endpoints */

function importUploadFile(): string
{
    $max = (int)cfg('IMPORT_MAX_BYTES', '52428800');

    if (isset($_FILES['file']) && is_array($_FILES['file'])) {
        $f = $_FILES['file'];
        $err = (int)($f['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
            fail(413, 'uploaded file exceeds the server limit');
        }
        if ($err !== UPLOAD_ERR_OK) {
            fail(400, 'file upload failed (code ' . $err . ')');
        }
        $size = (int)($f['size'] ?? 0);
        if ($size <= 0) {
            fail(400, 'uploaded file is empty');
        }
        if ($size > $max) {
            fail(413, 'file exceeds import limit of ' . $max . ' bytes');
        }
        $raw = file_get_contents((string)$f['tmp_name']);
        if ($raw === false || $raw === '') {
            fail(400, 'could not read uploaded file');
        }
        return $raw;
    }

    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        $len = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($len > 0) {
            fail(413, 'upload exceeded the PHP post_max_size limit (' . ini_get('post_max_size') . ')');
        }
        fail(400, "multipart field 'file' is required");
    }
    if (strlen($raw) > $max) {
        fail(413, 'file exceeds import limit of ' . $max . ' bytes');
    }
    return $raw;
}

function importFormField(string $key): string
{
    $v = $_POST[$key] ?? $_GET[$key] ?? '';
    return is_string($v) ? trim($v) : '';
}

function importMbox(): never
{
    $raw = importUploadFile();
    importRun('mbox', importFormField('targetEmail'), importFormField('targetFolder'), importFormField('targetPassword'), parseMbox($raw));
}

function importEml(): never
{
    $raw = importUploadFile();
    $messages = looksLikeMbox($raw)
        ? parseMbox($raw)
        : [['raw' => $raw, 'keywords' => null, 'receivedAt' => null, 'fromDate' => null]];
    importRun('eml', importFormField('targetEmail'), importFormField('targetFolder'), importFormField('targetPassword'), $messages);
}

function importImap(): never
{
    $b = body();
    $host = trim(stringField($b, 'host', 255));
    if (preg_match('/^[A-Za-z0-9.\-:\[\]]+$/', $host) !== 1) {
        fail(400, "field 'host' invalid");
    }
    $username = stringField($b, 'username', 255);
    $password = stringField($b, 'password', 1024);
    $ssl = (bool)($b['ssl'] ?? true);
    $starttls = (bool)($b['starttls'] ?? false);
    $port = intField($b, 'port', $ssl ? 993 : 143, 1, 65535);
    $sourceFolder = stringField($b, 'sourceFolder', 255, false) ?: 'INBOX';
    $targetEmail = stringField($b, 'targetEmail');
    $targetFolder = stringField($b, 'targetFolder', 255, false);
    $targetPassword = stringField($b, 'targetPassword', 1024, false);
    $limit = intField($b, 'limit', 0, 0, 100000);

    try {
        $client = new ImapClient($host, $port, $ssl, $starttls);
        $client->login($username, $password);
        $messages = $client->fetchAll($sourceFolder, $limit);
        $client->logout();
    } catch (RuntimeException $e) {
        fail(400, $e->getMessage());
    }

    importRun('imap', $targetEmail, $targetFolder, $targetPassword, $messages);
}

function importJobGet(string $id): never
{
    ensureImportTables();
    $st = db()->prepare('SELECT * FROM import_jobs WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!is_array($row)) {
        fail(404, 'import job not found');
    }
    $ident = $GLOBALS['import_identity'] ?? ['kind' => 'admin', 'username' => null];
    if ($ident['kind'] === 'user' && strcasecmp((string)$row['target_email'], (string)$ident['username']) !== 0) {
        fail(403, 'job belongs to another mailbox');
    }
    ok(importJobOut($row));
}

function importJobList(): never
{
    ensureImportTables();
    $ident = $GLOBALS['import_identity'] ?? ['kind' => 'admin', 'username' => null];
    $target = strtolower(trim((string)($_GET['targetEmail'] ?? '')));
    if ($ident['kind'] === 'user') {
        $target = (string)$ident['username'];
    }
    if ($target !== '') {
        $st = db()->prepare('SELECT * FROM import_jobs WHERE target_email = ? ORDER BY created_at DESC LIMIT 50');
        $st->execute([$target]);
    } else {
        $st = db()->query('SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT 50');
    }
    $rows = $st->fetchAll();
    ok(['jobs' => array_map('importJobOut', $rows), 'count' => count($rows)]);
}

/* ---------------------------------------------------------------- auth */

function bearer(): string
{
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (is_string($h) && preg_match('/^Bearer\s+(.+)$/i', $h, $m) === 1) {
        return trim($m[1]);
    }
    $k = $_SERVER['HTTP_X_SERVER_API_KEY'] ?? '';
    return is_string($k) ? trim($k) : '';
}

function authenticate(): string
{
    $given = bearer();
    if ($given !== '') {
        // Panel session token (issued by POST /auth/login) — see adminLogin().
        try {
            $sessUser = redis()->get('auth:session:' . hash('sha256', $given));
        } catch (Throwable) {
            $sessUser = null;
        }
        if (is_string($sessUser) && $sessUser !== '') {
            $GLOBALS['admin_user'] = $sessUser;
            return $given;
        }
    }
    $expected = cfg('AFFINMAIL_ADMIN_TOKEN');
    if ($expected === '' || $given === '' || !hash_equals($expected, $given)) {
        fail(401, 'unauthorized');
    }
    return $given;
}

function basicCredentials(): ?array
{
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!is_string($h) || preg_match('/^Basic\s+(.+)$/i', $h, $m) !== 1) {
        return null;
    }
    $decoded = base64_decode(trim($m[1]), true);
    if (!is_string($decoded) || !str_contains($decoded, ':')) {
        return null;
    }
    [$user, $pass] = explode(':', $decoded, 2);
    return ['email' => $user, 'password' => $pass];
}

/**
 * Import routes accept the admin Bearer token OR a user's Basic auth.
 * Returns ['kind' => 'admin'] or ['kind' => 'user', 'username' => email].
 */
function authenticateImport(): array
{
    $basic = basicCredentials();
    if ($basic !== null) {
        if (!validEmail($basic['email'])) {
            fail(401, 'unauthorized');
        }
        try {
            userSession($basic['email'], $basic['password']);
        } catch (RuntimeException) {
            fail(401, 'unauthorized');
        }
        return ['kind' => 'user', 'username' => strtolower($basic['email'])];
    }

    $expected = cfg('AFFINMAIL_ADMIN_TOKEN');
    $given = bearer();
    if ($expected === '' || $given === '' || !hash_equals($expected, $given)) {
        fail(401, 'unauthorized');
    }
    return ['kind' => 'admin', 'username' => null];
}

function rateLimit(string $token): void
{
    $key = 'ratelimit:api:' . hash('sha256', $token !== '' ? $token : ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    try {
        $r = redis();
        $n = (int)$r->incr($key);
        if ($n === 1) {
            $r->expire($key, 60);
        }
        if ($n > 120) {
            fail(429, 'rate limit exceeded');
        }
    } catch (Throwable) {
        // fail open: redis outage must not block admin API
    }
}

/* ---------------------------------------------------------------- import: parser self-test */

if (PHP_SAPI === 'cli' && in_array('--self-test-parsers', $argv ?? [], true)) {
    $raw = file_get_contents(__DIR__ . '/../../tests/fixtures/sample.mbox');
    $msgs = parseMbox((string)$raw);
    assert(count($msgs) === 3);
    $h = array_map(static fn(array $m): array => messageHeaders((string)$m['raw']), $msgs);
    assert(messageIdOf($h[0]) === 'import-test-1@affinmail.local');
    assert(messageIdOf($h[2]) === 'import-test-3@affinmail.local');
    assert(mboxKeywords($h[1]) === ['$seen' => true]);
    assert(mboxKeywords($h[0]) === []);
    assert(str_contains((string)$msgs[1]['raw'], "\nFrom this line"), 'mboxrd >From must be unescaped');
    assert(isoFromDate((string)$h[0]['date']) === '2026-11-24T10:00:00Z');
    $eml = (string)file_get_contents(__DIR__ . '/../../tests/fixtures/sample.eml');
    assert(!looksLikeMbox($eml));
    assert(messageIdOf(messageHeaders($eml)) === 'import-test-eml-1@affinmail.local');
    echo "parser self-test OK\n";
    exit(0);
}

/* ---------------------------------------------------------------- provisioning & client self-service */

function ensureProvisioningTables(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $pdo = db();
    $pdo->exec(
        "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";
        CREATE EXTENSION IF NOT EXISTS \"pgcrypto\";

        CREATE TABLE IF NOT EXISTS plans (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            slug VARCHAR(64) NOT NULL UNIQUE,
            name VARCHAR(128) NOT NULL,
            max_domains INTEGER NOT NULL DEFAULT 1,
            max_mailboxes INTEGER NOT NULL DEFAULT 5,
            storage_mb INTEGER NOT NULL DEFAULT 10240,
            max_attachment_size_mb INTEGER NOT NULL DEFAULT 25,
            hourly_rate_limit INTEGER NOT NULL DEFAULT 200,
            has_dedicated_ip BOOLEAN NOT NULL DEFAULT FALSE,
            has_sieve_vacation BOOLEAN NOT NULL DEFAULT TRUE,
            has_mcp_access BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS accounts (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            company_name VARCHAR(255) NOT NULL DEFAULT '',
            admin_email VARCHAR(255) NOT NULL,
            plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
            status VARCHAR(32) NOT NULL DEFAULT 'active',
            external_id VARCHAR(128) NULL,
            suspended_at TIMESTAMPTZ NULL,
            terminated_at TIMESTAMPTZ NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_accounts_admin_email ON accounts(admin_email);
        CREATE INDEX IF NOT EXISTS idx_accounts_external_id ON accounts(external_id);
        CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);

        ALTER TABLE domains ADD COLUMN IF NOT EXISTS account_id UUID NULL REFERENCES accounts(id) ON DELETE SET NULL;
        ALTER TABLE domains ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active';
        CREATE INDEX IF NOT EXISTS idx_domains_account ON domains(account_id);

        CREATE TABLE IF NOT EXISTS app_passwords (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
            label VARCHAR(128) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_used_at TIMESTAMPTZ NULL
        );
        CREATE INDEX IF NOT EXISTS idx_app_passwords_mailbox ON app_passwords(mailbox_id);

        CREATE TABLE IF NOT EXISTS mcp_tokens (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
            token_hash VARCHAR(255) NOT NULL UNIQUE,
            token_prefix VARCHAR(16) NOT NULL DEFAULT 'aff_',
            name VARCHAR(128) NOT NULL,
            scopes TEXT[] NOT NULL DEFAULT '{\"read\",\"send\",\"search\"}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NULL,
            last_used_at TIMESTAMPTZ NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_tokens_mailbox ON mcp_tokens(mailbox_id);
        CREATE INDEX IF NOT EXISTS idx_mcp_tokens_hash ON mcp_tokens(token_hash);

        CREATE TABLE IF NOT EXISTS mcp_audit_log (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
            token_id UUID NULL REFERENCES mcp_tokens(id) ON DELETE SET NULL,
            tool_name VARCHAR(128) NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'success',
            client_info JSONB NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_audit_mailbox_created ON mcp_audit_log(mailbox_id, created_at DESC);

        INSERT INTO plans (slug, name, max_domains, max_mailboxes, storage_mb, max_attachment_size_mb, hourly_rate_limit, has_dedicated_ip)
        VALUES
            ('starter', 'Starter', 1, 5, 10240, 25, 100, FALSE),
            ('professional', 'Professional', 5, 25, 51200, 50, 500, FALSE),
            ('enterprise', 'Enterprise', 25, 100, 204800, 100, 2000, TRUE)
        ON CONFLICT (slug) DO UPDATE SET
            name = EXCLUDED.name,
            max_domains = EXCLUDED.max_domains,
            max_mailboxes = EXCLUDED.max_mailboxes,
            storage_mb = EXCLUDED.storage_mb,
            max_attachment_size_mb = EXCLUDED.max_attachment_size_mb,
            hourly_rate_limit = EXCLUDED.hourly_rate_limit,
            has_dedicated_ip = EXCLUDED.has_dedicated_ip,
            updated_at = NOW();"
    );
    $done = true;
}

function findPlan(string $idOrSlug): ?array
{
    ensureProvisioningTables();
    $pdo = db();
    $st = $pdo->prepare('SELECT * FROM plans WHERE id::text = ? OR LOWER(slug) = LOWER(?)');
    $st->execute([$idOrSlug, $idOrSlug]);
    $row = $st->fetch();
    return $row ?: null;
}

function planOut(array $p): array
{
    return [
        'id'                  => $p['id'],
        'slug'                => $p['slug'],
        'name'                => $p['name'],
        'maxDomains'          => (int)$p['max_domains'],
        'maxMailboxes'        => (int)$p['max_mailboxes'],
        'storageMb'           => (int)$p['storage_mb'],
        'maxAttachmentSizeMb' => (int)$p['max_attachment_size_mb'],
        'hourlyRateLimit'     => (int)$p['hourly_rate_limit'],
        'hasDedicatedIp'      => (bool)$p['has_dedicated_ip'],
        'hasSieveVacation'    => (bool)($p['has_sieve_vacation'] ?? true),
        'hasMcpAccess'        => (bool)($p['has_mcp_access'] ?? true),
        'createdAt'           => $p['created_at'],
    ];
}

function findAccount(string $idOrExt): ?array
{
    ensureProvisioningTables();
    $pdo = db();
    $st = $pdo->prepare(
        'SELECT a.*, p.slug AS plan_slug, p.name AS plan_name, p.max_domains, p.max_mailboxes,
                p.storage_mb, p.max_attachment_size_mb, p.hourly_rate_limit, p.has_dedicated_ip,
                p.has_sieve_vacation, p.has_mcp_access
         FROM accounts a
         JOIN plans p ON p.id = a.plan_id
         WHERE a.id::text = ? OR a.external_id = ?'
    );
    $st->execute([$idOrExt, $idOrExt]);
    $row = $st->fetch();
    return $row ?: null;
}

function accountOut(array $a, ?array $extra = null): array
{
    $out = [
        'id'          => $a['id'],
        'companyName' => $a['company_name'] ?? '',
        'adminEmail'  => $a['admin_email'],
        'status'      => $a['status'],
        'externalId'  => $a['external_id'],
        'plan'        => [
            'id'                  => $a['plan_id'],
            'slug'                => $a['plan_slug'] ?? null,
            'name'                => $a['plan_name'] ?? null,
            'maxDomains'          => isset($a['max_domains']) ? (int)$a['max_domains'] : null,
            'maxMailboxes'        => isset($a['max_mailboxes']) ? (int)$a['max_mailboxes'] : null,
            'storageMb'           => isset($a['storage_mb']) ? (int)$a['storage_mb'] : null,
            'maxAttachmentSizeMb' => isset($a['max_attachment_size_mb']) ? (int)$a['max_attachment_size_mb'] : null,
            'hourlyRateLimit'     => isset($a['hourly_rate_limit']) ? (int)$a['hourly_rate_limit'] : null,
            'hasDedicatedIp'      => isset($a['has_dedicated_ip']) ? (bool)$a['has_dedicated_ip'] : false,
        ],
        'suspendedAt'  => $a['suspended_at'] ?? null,
        'terminatedAt' => $a['terminated_at'] ?? null,
        'createdAt'    => $a['created_at'],
    ];
    if ($extra !== null) {
        $out = array_merge($out, $extra);
    }
    return $out;
}

function findMailbox(string $idOrEmail): ?array
{
    $pdo = db();
    $st = $pdo->prepare(
        'SELECT m.*, d.domain_name, d.account_id
         FROM mailboxes m
         JOIN domains d ON d.id = m.domain_id
         WHERE m.id::text = ? OR LOWER(m.email) = LOWER(?)'
    );
    $st->execute([$idOrEmail, $idOrEmail]);
    $row = $st->fetch();
    return $row ?: null;
}

function provisionAccountCreate(): never
{
    ensureProvisioningTables();
    $b = body();
    $adminEmail = strtolower(stringField($b, 'adminEmail', 255, false));
    if ($adminEmail === '') {
        $adminEmail = strtolower(stringField($b, 'admin_email'));
    }
    if (!validEmail($adminEmail)) {
        apiFail(400, 'invalid admin email');
    }

    $domain = strtolower(stringField($b, 'domain', 255, false));
    if ($domain === '') {
        $domain = strtolower(stringField($b, 'domain_name', 255, false));
    }
    if ($domain === '') {
        $domain = strtolower(stringField($b, 'domainName'));
    }
    if (!validDomain($domain)) {
        apiFail(400, 'invalid domain name');
    }

    $companyName = stringField($b, 'companyName', 255, false);
    if ($companyName === '') {
        $companyName = stringField($b, 'company_name', 255, false);
    }

    $externalId = stringField($b, 'externalId', 128, false);
    if ($externalId === '') {
        $externalId = stringField($b, 'external_id', 128, false);
    }
    $externalId = $externalId !== '' ? $externalId : null;

    $planParam = stringField($b, 'plan', 64, false);
    if ($planParam === '') {
        $planParam = stringField($b, 'planId', 64, false);
    }
    if ($planParam === '') {
        $planParam = stringField($b, 'plan_id', 64, false);
    }
    $planParam = $planParam !== '' ? $planParam : 'starter';

    $plan = findPlan($planParam);
    if ($plan === null) {
        apiFail(404, "plan '{$planParam}' not found");
    }

    $password = stringField($b, 'password', 256, false);
    if ($password === '') {
        $password = bin2hex(random_bytes(8)) . '!Aa1';
    } elseif (strlen($password) < 8) {
        apiFail(400, 'password must be at least 8 characters');
    }

    $pdo = db();
    $dupDomain = $pdo->prepare('SELECT 1 FROM domains WHERE domain_name = ?');
    $dupDomain->execute([$domain]);
    if ($dupDomain->fetchColumn()) {
        apiFail(409, 'domain already exists');
    }

    $swDomainId = '';
    try {
        [$privKey, $pubKey] = dkimKeypair();
        $swDomainId = stalwartEnsureDomain($domain);
    } catch (RuntimeException $e) {
        apiFail(502, 'stalwart domain provisioning failed: ' . $e->getMessage());
    }

    $pdo->beginTransaction();
    try {
        $insAcc = $pdo->prepare(
            'INSERT INTO accounts (company_name, admin_email, plan_id, external_id, status)
             VALUES (?, ?, ?, ?, ?) RETURNING *'
        );
        $insAcc->execute([$companyName, $adminEmail, $plan['id'], $externalId, 'active']);
        $accRow = $insAcc->fetch();

        $insDom = $pdo->prepare(
            'INSERT INTO domains (domain_name, account_id, max_mailboxes, max_attachment_size_mb,
                                  disk_quota_mb, dkim_selector, dkim_private_key, dkim_public_key,
                                  stalwart_domain_id, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *'
        );
        $insDom->execute([
            $domain,
            $accRow['id'],
            $plan['max_mailboxes'],
            $plan['max_attachment_size_mb'],
            $plan['storage_mb'],
            'affinmail',
            $privKey,
            $pubKey,
            $swDomainId,
            'active',
        ]);
        $domRow = $insDom->fetch();

        $localpart = explode('@', $adminEmail)[0];
        if (!preg_match('/^[a-z0-9._%+\-]+$/i', $localpart)) {
            $localpart = 'admin';
        }
        $primaryEmail = "{$localpart}@{$domain}";
        $swAcctId = stalwartCreateAccount($localpart, $swDomainId, $companyName !== '' ? $companyName : 'Admin', $password);

        $pwHash = password_hash($password, PASSWORD_BCRYPT);
        $vault = null;
        try {
            $vault = vaultEncrypt($password);
        } catch (Throwable) {
        }

        $insMb = $pdo->prepare(
            'INSERT INTO mailboxes (domain_id, email, username, password_hash, display_name,
                                    quota_limit_mb, hourly_rate_limit, outbound_route, status,
                                    is_admin, stalwart_account_id, secret_vault)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *'
        );
        $insMb->execute([
            $domRow['id'],
            $primaryEmail,
            $localpart,
            $pwHash,
            $companyName !== '' ? $companyName : 'Administrator',
            $plan['storage_mb'],
            $plan['hourly_rate_limit'],
            'direct',
            'active',
            true,
            $swAcctId,
            $vault,
        ]);
        $mbRow = $insMb->fetch();

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        try {
            if ($swDomainId !== '') {
                stalwartDestroyDomain($swDomainId);
            }
        } catch (Throwable) {
        }
        apiFail(500, 'provisioning account failed: ' . $e->getMessage());
    }

    $accOut = accountOut(array_merge($accRow, [
        'plan_slug'            => $plan['slug'],
        'plan_name'            => $plan['name'],
        'max_domains'          => $plan['max_domains'],
        'max_mailboxes'        => $plan['max_mailboxes'],
        'storage_mb'           => $plan['storage_mb'],
        'max_attachment_size_mb' => $plan['max_attachment_size_mb'],
        'hourly_rate_limit'    => $plan['hourly_rate_limit'],
        'has_dedicated_ip'     => $plan['has_dedicated_ip'],
    ]), [
        'domain'         => domainOut($domRow),
        'primaryMailbox' => [
            'id'              => $mbRow['id'],
            'email'           => $primaryEmail,
            'username'        => $localpart,
            'initialPassword' => $password,
        ],
    ]);

    ok($accOut, 201);
}

function provisionAccountGet(string $id): never
{
    $acc = findAccount($id);
    if ($acc === null) {
        apiFail(404, 'account not found');
    }
    $pdo = db();
    $domCountSt = $pdo->prepare('SELECT COUNT(*) FROM domains WHERE account_id = ?');
    $domCountSt->execute([$acc['id']]);
    $domainCount = (int)$domCountSt->fetchColumn();

    $mbCountSt = $pdo->prepare('SELECT COUNT(*) FROM mailboxes m JOIN domains d ON d.id = m.domain_id WHERE d.account_id = ?');
    $mbCountSt->execute([$acc['id']]);
    $mailboxCount = (int)$mbCountSt->fetchColumn();

    ok(accountOut($acc, [
        'domainCount'  => $domainCount,
        'mailboxCount' => $mailboxCount,
    ]));
}

function provisionAccountList(): never
{
    ensureProvisioningTables();
    $rows = db()->query(
        'SELECT a.*, p.slug AS plan_slug, p.name AS plan_name, p.max_domains, p.max_mailboxes,
                p.storage_mb, p.max_attachment_size_mb, p.hourly_rate_limit, p.has_dedicated_ip
         FROM accounts a
         JOIN plans p ON p.id = a.plan_id
         ORDER BY a.created_at DESC'
    )->fetchAll();
    ok(['accounts' => array_map('accountOut', $rows), 'count' => count($rows)]);
}

function provisionAccountPlan(string $id): never
{
    $acc = findAccount($id);
    if ($acc === null) {
        apiFail(404, 'account not found');
    }
    $b = body();
    $planParam = stringField($b, 'plan', 64, false);
    if ($planParam === '') {
        $planParam = stringField($b, 'planId', 64, false);
    }
    if ($planParam === '') {
        $planParam = stringField($b, 'plan_id', 64, false);
    }
    if ($planParam === '') {
        apiFail(400, "field 'plan' or 'planId' is required");
    }
    $plan = findPlan($planParam);
    if ($plan === null) {
        apiFail(404, "plan '{$planParam}' not found");
    }

    $pdo = db();
    $pdo->prepare('UPDATE accounts SET plan_id = ?, updated_at = NOW() WHERE id = ?')->execute([$plan['id'], $acc['id']]);
    $pdo->prepare(
        'UPDATE domains
         SET max_mailboxes = ?, max_attachment_size_mb = ?, disk_quota_mb = ?, updated_at = NOW()
         WHERE account_id = ?'
    )->execute([$plan['max_mailboxes'], $plan['max_attachment_size_mb'], $plan['storage_mb'], $acc['id']]);

    $updated = findAccount($acc['id']);
    ok(accountOut($updated));
}

function provisionAccountSuspend(string $id): never
{
    $acc = findAccount($id);
    if ($acc === null) {
        apiFail(404, 'account not found');
    }
    $pdo = db();
    $pdo->prepare("UPDATE accounts SET status = 'suspended', suspended_at = NOW(), updated_at = NOW() WHERE id = ?")->execute([$acc['id']]);
    $pdo->prepare("UPDATE domains SET status = 'suspended', is_active = FALSE, updated_at = NOW() WHERE account_id = ?")->execute([$acc['id']]);
    $pdo->prepare(
        "UPDATE mailboxes SET status = 'suspended', updated_at = NOW()
         WHERE domain_id IN (SELECT id FROM domains WHERE account_id = ?)"
    )->execute([$acc['id']]);

    ok(['status' => 'suspended', 'accountId' => $acc['id'], 'suspendedAt' => gmdate('c')]);
}

function provisionAccountUnsuspend(string $id): never
{
    $acc = findAccount($id);
    if ($acc === null) {
        apiFail(404, 'account not found');
    }
    $pdo = db();
    $pdo->prepare("UPDATE accounts SET status = 'active', suspended_at = NULL, updated_at = NOW() WHERE id = ?")->execute([$acc['id']]);
    $pdo->prepare("UPDATE domains SET status = 'active', is_active = TRUE, updated_at = NOW() WHERE account_id = ?")->execute([$acc['id']]);
    $pdo->prepare(
        "UPDATE mailboxes SET status = 'active', updated_at = NOW()
         WHERE domain_id IN (SELECT id FROM domains WHERE account_id = ?)"
    )->execute([$acc['id']]);

    ok(['status' => 'active', 'accountId' => $acc['id']]);
}

function provisionAccountTerminate(string $id): never
{
    $acc = findAccount($id);
    if ($acc === null) {
        apiFail(404, 'account not found');
    }
    $pdo = db();
    $pdo->prepare("UPDATE accounts SET status = 'terminated', terminated_at = NOW(), updated_at = NOW() WHERE id = ?")->execute([$acc['id']]);
    $pdo->prepare("UPDATE domains SET status = 'terminated', is_active = FALSE, updated_at = NOW() WHERE account_id = ?")->execute([$acc['id']]);
    $pdo->prepare(
        "UPDATE mailboxes SET status = 'suspended', updated_at = NOW()
         WHERE domain_id IN (SELECT id FROM domains WHERE account_id = ?)"
    )->execute([$acc['id']]);

    ok([
        'status'           => 'terminated',
        'accountId'        => $acc['id'],
        'terminatedAt'     => gmdate('c'),
        'gracePeriodDays'  => 30,
        'purgeScheduledAt' => gmdate('c', time() + 30 * 86400),
    ]);
}

function provisionAccountDelete(string $id): never
{
    $acc = findAccount($id);
    if ($acc === null) {
        apiFail(404, 'account not found');
    }
    $pdo = db();
    $domSt = $pdo->prepare('SELECT * FROM domains WHERE account_id = ?');
    $domSt->execute([$acc['id']]);
    $domains = $domSt->fetchAll();
    foreach ($domains as $d) {
        try {
            $swId = $d['stalwart_domain_id'] ?? null;
            if (!$swId) {
                $sw = stalwartFindDomain($d['domain_name']);
                $swId = $sw['id'] ?? null;
            }
            if ($swId) {
                stalwartDestroyDomain((string)$swId);
            }
        } catch (Throwable) {
        }
        $pdo->prepare('DELETE FROM domains WHERE id = ?')->execute([$d['id']]);
    }
    $pdo->prepare('DELETE FROM accounts WHERE id = ?')->execute([$acc['id']]);
    ok(['deleted' => true, 'accountId' => $acc['id']]);
}

function provisionDomainAdd(string $accountId): never
{
    $acc = findAccount($accountId);
    if ($acc === null) {
        apiFail(404, 'account not found');
    }
    if ($acc['status'] === 'terminated') {
        apiFail(400, 'cannot add domain to terminated account');
    }
    $pdo = db();
    $countSt = $pdo->prepare('SELECT COUNT(*) FROM domains WHERE account_id = ?');
    $countSt->execute([$acc['id']]);
    $currentCount = (int)$countSt->fetchColumn();
    if ($currentCount >= (int)$acc['max_domains']) {
        apiFail(400, "domain limit ({$acc['max_domains']}) reached for account plan");
    }

    $b = body();
    $domain = strtolower(stringField($b, 'domain'));
    if (!validDomain($domain)) {
        apiFail(400, 'invalid domain name');
    }

    $dup = $pdo->prepare('SELECT 1 FROM domains WHERE domain_name = ?');
    $dup->execute([$domain]);
    if ($dup->fetchColumn()) {
        apiFail(409, 'domain already exists');
    }

    try {
        [$priv, $pub] = dkimKeypair();
        $swId = stalwartEnsureDomain($domain);
    } catch (RuntimeException $e) {
        apiFail(502, 'stalwart domain provisioning failed: ' . $e->getMessage());
    }

    $ins = $pdo->prepare(
        'INSERT INTO domains (domain_name, account_id, max_mailboxes, max_attachment_size_mb,
                              disk_quota_mb, dkim_selector, dkim_private_key, dkim_public_key,
                              stalwart_domain_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *'
    );
    $ins->execute([
        $domain,
        $acc['id'],
        $acc['max_mailboxes'],
        $acc['max_attachment_size_mb'],
        $acc['storage_mb'],
        'affinmail',
        $priv,
        $pub,
        $swId,
        'active',
    ]);
    ok(domainOut($ins->fetch()), 201);
}

function provisionDomainRemove(string $accountId, string $domain): never
{
    $acc = findAccount($accountId);
    if ($acc === null) {
        apiFail(404, 'account not found');
    }
    $domain = strtolower($domain);
    $pdo = db();
    $st = $pdo->prepare('SELECT * FROM domains WHERE domain_name = ? AND account_id = ?');
    $st->execute([$domain, $acc['id']]);
    $row = $st->fetch();
    if (!$row) {
        apiFail(404, 'domain not found for this account');
    }

    try {
        $swId = $row['stalwart_domain_id'] ?? null;
        if (!$swId) {
            $sw = stalwartFindDomain($domain);
            $swId = $sw['id'] ?? null;
        }
        if ($swId) {
            stalwartDestroyDomain((string)$swId);
        }
    } catch (Throwable) {
    }

    $pdo->prepare('DELETE FROM domains WHERE id = ?')->execute([$row['id']]);
    ok(['deleted' => true, 'domain' => $domain]);
}

function provisionDomainList(string $accountId): never
{
    $acc = findAccount($accountId);
    if ($acc === null) {
        apiFail(404, 'account not found');
    }
    $pdo = db();
    $st = $pdo->prepare(
        'SELECT d.*, COUNT(m.id) AS mailbox_count
         FROM domains d
         LEFT JOIN mailboxes m ON m.domain_id = d.id
         WHERE d.account_id = ?
         GROUP BY d.id
         ORDER BY d.domain_name'
    );
    $st->execute([$acc['id']]);
    $rows = $st->fetchAll();
    ok([
        'accountId' => $acc['id'],
        'domains'   => array_map('domainOut', $rows),
        'count'     => count($rows),
    ]);
}

function provisionAccountUsage(string $accountId): never
{
    $acc = findAccount($accountId);
    if ($acc === null) {
        apiFail(404, 'account not found');
    }
    $pdo = db();

    $mbSt = $pdo->prepare(
        'SELECT COUNT(*) AS total_mailboxes, COALESCE(SUM(quota_used_bytes), 0) AS total_storage_used_bytes
         FROM mailboxes m
         JOIN domains d ON d.id = m.domain_id
         WHERE d.account_id = ?'
    );
    $mbSt->execute([$acc['id']]);
    $mbStats = $mbSt->fetch();

    $usageSt = $pdo->prepare(
        'SELECT COALESCE(SUM(emails_sent_count), 0) AS emails_sent,
                COALESCE(SUM(emails_received_count), 0) AS emails_received
         FROM usage_records u
         JOIN domains d ON d.id = u.domain_id
         WHERE d.account_id = ?'
    );
    $usageSt->execute([$acc['id']]);
    $uStats = $usageSt->fetch();

    $bytes = (int)($mbStats['total_storage_used_bytes'] ?? 0);
    ok([
        'accountId'             => $acc['id'],
        'mailboxCount'          => (int)($mbStats['total_mailboxes'] ?? 0),
        'totalStorageUsedBytes' => $bytes,
        'totalStorageUsedMb'    => round($bytes / 1048576, 2),
        'emailsSent'            => (int)($uStats['emails_sent'] ?? 0),
        'emailsReceived'        => (int)($uStats['emails_received'] ?? 0),
    ]);
}

function provisionAccountQuota(string $accountId): never
{
    $acc = findAccount($accountId);
    if ($acc === null) {
        apiFail(404, 'account not found');
    }
    $pdo = db();

    $domCountSt = $pdo->prepare('SELECT COUNT(*) FROM domains WHERE account_id = ?');
    $domCountSt->execute([$acc['id']]);
    $domCount = (int)$domCountSt->fetchColumn();

    $mbSt = $pdo->prepare(
        'SELECT COUNT(*) AS mailbox_count, COALESCE(SUM(quota_used_bytes), 0) AS used_bytes
         FROM mailboxes m
         JOIN domains d ON d.id = m.domain_id
         WHERE d.account_id = ?'
    );
    $mbSt->execute([$acc['id']]);
    $mbStats = $mbSt->fetch();

    $usedMb = round(((int)($mbStats['used_bytes'] ?? 0)) / 1048576, 2);
    $limitMb = (int)$acc['storage_mb'];
    $storagePct = $limitMb > 0 ? round(($usedMb / $limitMb) * 100, 1) : 0;

    ok([
        'accountId' => $acc['id'],
        'plan'      => $acc['plan_slug'],
        'domains'   => [
            'used'  => $domCount,
            'limit' => (int)$acc['max_domains'],
        ],
        'mailboxes' => [
            'used'  => (int)($mbStats['mailbox_count'] ?? 0),
            'limit' => (int)$acc['max_mailboxes'],
        ],
        'storage'   => [
            'usedMb'     => $usedMb,
            'limitMb'    => $limitMb,
            'percentage' => $storagePct,
        ],
        'rateLimitPerHour' => (int)$acc['hourly_rate_limit'],
    ]);
}

function provisionSsoToken(): never
{
    $b = body();
    $email = strtolower(stringField($b, 'email'));
    if (!validEmail($email)) {
        apiFail(400, 'invalid email address');
    }
    $ttl = intField($b, 'ttlSeconds', 120, 30, 86400);

    $mb = findMailbox($email);
    if ($mb === null && stalwartFindAccountByEmail($email) === null) {
        apiFail(404, 'mailbox not found');
    }

    $secret = cfg('AFFINMAIL_ADMIN_TOKEN', cfg('VAULT_KEY', 'affinmail-sso-secret'));
    $payloadData = [
        'email' => $email,
        'exp'   => time() + $ttl,
        'nonce' => bin2hex(random_bytes(16)),
    ];
    $payloadJson = json_encode($payloadData, JSON_UNESCAPED_SLASHES);
    $b64Payload = rtrim(strtr(base64_encode($payloadJson), '+/', '-_'), '=');
    $sig = rtrim(strtr(base64_encode(hash_hmac('sha256', $b64Payload, $secret, true)), '+/', '-_'), '=');
    $token = $b64Payload . '.' . $sig;

    try {
        redis()->setex('auth:sso:token:' . $token, $ttl, $email);
    } catch (Throwable) {
    }

    $webmailBase = cfg('WEBMAIL_URL', 'https://mail.hostaffin.com');
    ok([
        'token'     => $token,
        'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', time() + $ttl),
        'expiresIn' => $ttl,
        'ssoUrl'    => rtrim($webmailBase, '/') . '/sso?token=' . $token,
    ]);
}

function provisionPlanList(): never
{
    ensureProvisioningTables();
    $rows = db()->query('SELECT * FROM plans ORDER BY storage_mb ASC')->fetchAll();
    ok(['plans' => array_map('planOut', $rows), 'count' => count($rows)]);
}

function provisionPlanGet(string $id): never
{
    $plan = findPlan($id);
    if ($plan === null) {
        apiFail(404, 'plan not found');
    }
    ok(planOut($plan));
}

function clientDashboard(): never
{
    $domainName = isset($_GET['domain']) ? strtolower(trim((string)$_GET['domain'])) : '';
    $mailboxEmail = isset($_GET['mailbox']) ? strtolower(trim((string)$_GET['mailbox'])) : '';

    $pdo = db();
    if ($domainName !== '') {
        $domSt = $pdo->prepare('SELECT * FROM domains WHERE domain_name = ?');
        $domSt->execute([$domainName]);
        $domain = $domSt->fetch();
        if (!$domain) {
            apiFail(404, 'domain not found');
        }

        $mbCountSt = $pdo->prepare(
            'SELECT COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN status = \'active\' THEN 1 ELSE 0 END), 0) AS active_count,
                    COALESCE(SUM(quota_used_bytes), 0) AS used_bytes
             FROM mailboxes WHERE domain_id = ?'
        );
        $mbCountSt->execute([$domain['id']]);
        $mbStats = $mbCountSt->fetch();

        $aliasSt = $pdo->prepare('SELECT COUNT(*) FROM aliases WHERE domain_id = ?');
        $aliasSt->execute([$domain['id']]);
        $aliasCount = (int)$aliasSt->fetchColumn();

        $dnsCheck = clientPerformDnsCheck($domainName);

        ok([
            'domain'       => domainOut($domain),
            'mailboxes'    => [
                'total'     => (int)($mbStats['total'] ?? 0),
                'active'    => (int)($mbStats['active_count'] ?? 0),
                'limit'     => (int)$domain['max_mailboxes'],
            ],
            'aliasesCount' => $aliasCount,
            'storage'      => [
                'usedBytes'  => (int)($mbStats['used_bytes'] ?? 0),
                'usedMb'     => round(((int)($mbStats['used_bytes'] ?? 0)) / 1048576, 2),
                'limitMb'    => (int)$domain['disk_quota_mb'],
                'percentage' => (int)$domain['disk_quota_mb'] > 0
                    ? round((((int)($mbStats['used_bytes'] ?? 0)) / 1048576 / (int)$domain['disk_quota_mb']) * 100, 1)
                    : 0,
            ],
            'dnsHealth'    => [
                'allValid' => $dnsCheck['allValid'],
                'summary'  => $dnsCheck['summary'],
            ],
        ]);
    }

    if ($mailboxEmail !== '') {
        $mb = findMailbox($mailboxEmail);
        if (!$mb) {
            apiFail(404, 'mailbox not found');
        }
        $usedBytes = (int)$mb['quota_used_bytes'];
        $limitMb = (int)$mb['quota_limit_mb'];
        $usedMb = round($usedBytes / 1048576, 2);

        $msgSt = $pdo->prepare(
            'SELECT COUNT(*) AS total_messages,
                    COALESCE(SUM(CASE WHEN is_read = FALSE THEN 1 ELSE 0 END), 0) AS unread_messages
             FROM email_messages WHERE mailbox_id = ?'
        );
        $msgSt->execute([$mb['id']]);
        $mStats = $msgSt->fetch();

        ok([
            'mailbox' => mailboxOut($mb),
            'storage' => [
                'usedBytes'  => $usedBytes,
                'usedMb'     => $usedMb,
                'limitMb'    => $limitMb,
                'percentage' => $limitMb > 0 ? round(($usedMb / $limitMb) * 100, 1) : 0,
            ],
            'messages' => [
                'total'  => (int)($mStats['total_messages'] ?? 0),
                'unread' => (int)($mStats['unread_messages'] ?? 0),
            ],
        ]);
    }

    $domTotal = (int)$pdo->query('SELECT COUNT(*) FROM domains')->fetchColumn();
    $mbTotal = (int)$pdo->query('SELECT COUNT(*) FROM mailboxes')->fetchColumn();
    $usedBytesTotal = (int)$pdo->query('SELECT COALESCE(SUM(quota_used_bytes), 0) FROM mailboxes')->fetchColumn();

    ok([
        'totalDomains'   => $domTotal,
        'totalMailboxes' => $mbTotal,
        'totalStorage'   => [
            'usedBytes' => $usedBytesTotal,
            'usedMb'    => round($usedBytesTotal / 1048576, 2),
        ],
    ]);
}

function clientMailboxList(string $domain): never
{
    $pdo = db();
    $st = $pdo->prepare('SELECT id FROM domains WHERE domain_name = ?');
    $st->execute([strtolower($domain)]);
    $domId = $st->fetchColumn();
    if (!$domId) {
        apiFail(404, 'domain not found');
    }
    $mbSt = $pdo->prepare('SELECT m.*, d.domain_name FROM mailboxes m JOIN domains d ON d.id = m.domain_id WHERE m.domain_id = ? ORDER BY m.email');
    $mbSt->execute([$domId]);
    $rows = $mbSt->fetchAll();
    ok(['mailboxes' => array_map('mailboxOut', $rows), 'count' => count($rows)]);
}

function clientMailboxCreate(string $domain): never
{
    $domain = strtolower($domain);
    $pdo = db();
    $st = $pdo->prepare('SELECT * FROM domains WHERE domain_name = ?');
    $st->execute([$domain]);
    $domRow = $st->fetch();
    if (!$domRow) {
        apiFail(404, 'domain not found');
    }

    $countSt = $pdo->prepare('SELECT COUNT(*) FROM mailboxes WHERE domain_id = ?');
    $countSt->execute([$domRow['id']]);
    if ((int)$countSt->fetchColumn() >= (int)$domRow['max_mailboxes']) {
        apiFail(400, 'domain mailbox limit reached');
    }

    $b = body();
    $username = strtolower(stringField($b, 'username', 64, false));
    $email = strtolower(stringField($b, 'email', 255, false));
    if ($username === '' && $email !== '') {
        $username = explode('@', $email)[0];
    } elseif ($email === '' && $username !== '') {
        $email = "{$username}@{$domain}";
    }
    if ($email === '' || !validEmail($email)) {
        apiFail(400, 'invalid email or username');
    }
    if (!str_ends_with($email, '@' . $domain)) {
        apiFail(400, "mailbox email must belong to domain '{$domain}'");
    }

    $password = stringField($b, 'password', 256);
    if (strlen($password) < 8) {
        apiFail(400, 'password must be at least 8 characters');
    }
    $displayName = stringField($b, 'displayName', 128, false);
    $quotaMb = intField($b, 'quotaLimitMb', (int)$domRow['disk_quota_mb'], 1, 10000000);

    $dup = $pdo->prepare('SELECT 1 FROM mailboxes WHERE email = ?');
    $dup->execute([$email]);
    if ($dup->fetchColumn()) {
        apiFail(409, 'mailbox already exists');
    }

    try {
        $swId = stalwartCreateAccount($username, (string)$domRow['stalwart_domain_id'], $displayName, $password);
    } catch (RuntimeException $e) {
        apiFail(502, 'stalwart account create failed: ' . $e->getMessage());
    }

    $pwHash = password_hash($password, PASSWORD_BCRYPT);
    $vault = null;
    try {
        $vault = vaultEncrypt($password);
    } catch (Throwable) {
    }

    $ins = $pdo->prepare(
        'INSERT INTO mailboxes (domain_id, email, username, password_hash, display_name,
                                quota_limit_mb, hourly_rate_limit, outbound_route, status,
                                is_admin, stalwart_account_id, secret_vault)
         VALUES (?, ?, ?, ?, ?, ?, 200, \'direct\', \'active\', false, ?, ?) RETURNING *'
    );
    $ins->execute([$domRow['id'], $email, $username, $pwHash, $displayName, $quotaMb, $swId, $vault]);
    $created = $ins->fetch();
    $created['domain_name'] = $domain;
    ok(mailboxOut($created), 201);
}

function clientMailboxUpdate(string $id): never
{
    $mb = findMailbox($id);
    if (!$mb) {
        apiFail(404, 'mailbox not found');
    }
    $b = body();
    $displayName = array_key_exists('displayName', $b) ? stringField($b, 'displayName', 128, false) : $mb['display_name'];
    $quotaLimitMb = array_key_exists('quotaLimitMb', $b) ? intField($b, 'quotaLimitMb', 5120, 1, 10000000) : (int)$mb['quota_limit_mb'];
    $hourlyRate = array_key_exists('hourlyRateLimit', $b) ? intField($b, 'hourlyRateLimit', 200, 0, 1000000) : (int)$mb['hourly_rate_limit'];
    $status = array_key_exists('status', $b) ? stringField($b, 'status', 32) : $mb['status'];
    if (!in_array($status, ['active', 'suspended', 'pending_deletion'], true)) {
        apiFail(400, 'invalid status');
    }

    $pdo = db();
    $upd = $pdo->prepare(
        'UPDATE mailboxes
         SET display_name = ?, quota_limit_mb = ?, hourly_rate_limit = ?, status = ?, updated_at = NOW()
         WHERE id = ? RETURNING *'
    );
    $upd->execute([$displayName, $quotaLimitMb, $hourlyRate, $status, $mb['id']]);
    $updated = $upd->fetch();
    $updated['domain_name'] = $mb['domain_name'];
    ok(mailboxOut($updated));
}

function clientMailboxDelete(string $id): never
{
    $mb = findMailbox($id);
    if (!$mb) {
        apiFail(404, 'mailbox not found');
    }
    try {
        if (!empty($mb['stalwart_account_id'])) {
            stalwartDestroyAccount((string)$mb['stalwart_account_id']);
        }
    } catch (Throwable) {
    }

    db()->prepare('DELETE FROM mailboxes WHERE id = ?')->execute([$mb['id']]);
    ok(['deleted' => true, 'mailbox' => $mb['email']]);
}

function clientMailboxPassword(string $id): never
{
    $mb = findMailbox($id);
    if (!$mb) {
        apiFail(404, 'mailbox not found');
    }
    $b = body();
    $password = stringField($b, 'password', 256);
    if (strlen($password) < 8) {
        apiFail(400, 'password must be at least 8 characters');
    }

    try {
        if (!empty($mb['stalwart_account_id'])) {
            stalwartSetPassword((string)$mb['stalwart_account_id'], $password);
        }
    } catch (RuntimeException $e) {
        apiFail(502, 'stalwart password update failed: ' . $e->getMessage());
    }

    $pwHash = password_hash($password, PASSWORD_BCRYPT);
    $vault = null;
    try {
        $vault = vaultEncrypt($password);
    } catch (Throwable) {
    }

    db()->prepare('UPDATE mailboxes SET password_hash = ?, secret_vault = ?, updated_at = NOW() WHERE id = ?')
        ->execute([$pwHash, $vault, $mb['id']]);

    ok(['updated' => true, 'mailbox' => $mb['email']]);
}

function clientAliasList(string $domain): never
{
    $pdo = db();
    $domSt = $pdo->prepare('SELECT id FROM domains WHERE domain_name = ?');
    $domSt->execute([strtolower($domain)]);
    $domId = $domSt->fetchColumn();
    if (!$domId) {
        apiFail(404, 'domain not found');
    }

    $st = $pdo->prepare('SELECT * FROM aliases WHERE domain_id = ? ORDER BY source_address');
    $st->execute([$domId]);
    $rows = $st->fetchAll();
    ok([
        'aliases' => array_map(static fn(array $r): array => [
            'id'          => $r['id'],
            'source'      => $r['source_address'],
            'destination' => $r['destination_address'],
            'isActive'    => (bool)$r['is_active'],
            'createdAt'   => $r['created_at'],
        ], $rows),
        'count'   => count($rows),
    ]);
}

function clientAliasCreate(string $domain): never
{
    $domain = strtolower($domain);
    $pdo = db();
    $domSt = $pdo->prepare('SELECT id FROM domains WHERE domain_name = ?');
    $domSt->execute([$domain]);
    $domId = $domSt->fetchColumn();
    if (!$domId) {
        apiFail(404, 'domain not found');
    }

    $b = body();
    $source = strtolower(stringField($b, 'source'));
    if (!str_contains($source, '@')) {
        $source = "{$source}@{$domain}";
    }
    if (!validEmail($source) || !str_ends_with($source, '@' . $domain)) {
        apiFail(400, "source alias must belong to domain '{$domain}'");
    }

    $dest = strtolower(stringField($b, 'destination'));
    if (!validEmail($dest)) {
        apiFail(400, 'invalid destination email address');
    }

    $ins = $pdo->prepare('INSERT INTO aliases (domain_id, source_address, destination_address, is_active) VALUES (?, ?, ?, TRUE) RETURNING *');
    $ins->execute([$domId, $source, $dest]);
    $row = $ins->fetch();
    ok([
        'id'          => $row['id'],
        'source'      => $row['source_address'],
        'destination' => $row['destination_address'],
        'isActive'    => (bool)$row['is_active'],
        'createdAt'   => $row['created_at'],
    ], 201);
}

function clientAliasDelete(string $id): never
{
    $pdo = db();
    $st = $pdo->prepare('DELETE FROM aliases WHERE id::text = ?');
    $st->execute([$id]);
    if ($st->rowCount() === 0) {
        apiFail(404, 'alias not found');
    }
    ok(['deleted' => true, 'aliasId' => $id]);
}

function clientForwardingGet(string $id): never
{
    $mb = findMailbox($id);
    if (!$mb) {
        apiFail(404, 'mailbox not found');
    }
    $pdo = db();
    $st = $pdo->prepare('SELECT destination_address FROM aliases WHERE source_address = ? AND is_active = TRUE');
    $st->execute([$mb['email']]);
    $destinations = $st->fetchAll(PDO::FETCH_COLUMN);

    ok([
        'mailbox'           => $mb['email'],
        'forwardingEnabled' => count($destinations) > 0,
        'destinations'      => $destinations,
        'keepCopy'          => true,
    ]);
}

function clientForwardingUpdate(string $id): never
{
    $mb = findMailbox($id);
    if (!$mb) {
        apiFail(404, 'mailbox not found');
    }
    $b = body();
    $enabled = (bool)($b['enabled'] ?? true);
    $destinations = is_array($b['destinations'] ?? null) ? $b['destinations'] : [];
    $validDests = [];
    foreach ($destinations as $d) {
        $d = strtolower(trim((string)$d));
        if ($d !== '' && validEmail($d)) {
            $validDests[] = $d;
        }
    }
    if ($enabled && empty($validDests)) {
        apiFail(400, 'at least one valid destination email is required when forwarding is enabled');
    }

    $pdo = db();
    $pdo->prepare('DELETE FROM aliases WHERE source_address = ?')->execute([$mb['email']]);
    if ($enabled) {
        $ins = $pdo->prepare('INSERT INTO aliases (domain_id, source_address, destination_address, is_active) VALUES (?, ?, ?, TRUE)');
        foreach ($validDests as $vd) {
            $ins->execute([$mb['domain_id'], $mb['email'], $vd]);
        }
    }

    ok([
        'mailbox'           => $mb['email'],
        'forwardingEnabled' => $enabled,
        'destinations'      => $validDests,
        'keepCopy'          => (bool)($b['keepCopy'] ?? true),
    ]);
}

function clientAutoresponderGet(string $id): never
{
    $mb = findMailbox($id);
    if (!$mb) {
        apiFail(404, 'mailbox not found');
    }
    $pdo = db();
    $st = $pdo->prepare('SELECT * FROM sieve_scripts WHERE mailbox_id = ? AND script_name = \'vacation\'');
    $st->execute([$mb['id']]);
    $row = $st->fetch();

    if (!$row) {
        ok([
            'mailbox'   => $mb['email'],
            'enabled'   => false,
            'subject'   => '',
            'body'      => '',
            'startDate' => null,
            'endDate'   => null,
        ]);
    }

    ok([
        'mailbox'   => $mb['email'],
        'enabled'   => (bool)$row['is_vacation_active'],
        'subject'   => (string)($row['vacation_subject'] ?? ''),
        'body'      => (string)($row['vacation_body'] ?? ''),
        'startDate' => $row['vacation_start'],
        'endDate'   => $row['vacation_end'],
        'updatedAt' => $row['updated_at'],
    ]);
}

function clientAutoresponderUpdate(string $id): never
{
    $mb = findMailbox($id);
    if (!$mb) {
        apiFail(404, 'mailbox not found');
    }
    $b = body();
    $enabled = (bool)($b['enabled'] ?? true);
    $subject = stringField($b, 'subject', 255, false);
    $body = is_string($b['body'] ?? null) ? trim($b['body']) : '';
    $start = !empty($b['startDate']) ? (string)$b['startDate'] : null;
    $end = !empty($b['endDate']) ? (string)$b['endDate'] : null;

    $sieveScript = 'require ["vacation"]; vacation :days 1 :subject "' . addcslashes($subject, '"\\') . '" "' . addcslashes($body, '"\\') . '";';

    $pdo = db();
    $check = $pdo->prepare('SELECT id FROM sieve_scripts WHERE mailbox_id = ? AND script_name = \'vacation\'');
    $check->execute([$mb['id']]);
    $existingId = $check->fetchColumn();

    if ($existingId) {
        $upd = $pdo->prepare(
            'UPDATE sieve_scripts
             SET script_content = ?, is_active = ?, is_vacation_active = ?, vacation_subject = ?,
                 vacation_body = ?, vacation_start = ?, vacation_end = ?, updated_at = NOW()
             WHERE id = ?'
        );
        $upd->execute([$sieveScript, $enabled, $enabled, $subject, $body, $start, $end, $existingId]);
    } else {
        $ins = $pdo->prepare(
            'INSERT INTO sieve_scripts (mailbox_id, script_name, script_content, is_active,
                                        is_vacation_active, vacation_subject, vacation_body,
                                        vacation_start, vacation_end)
             VALUES (?, \'vacation\', ?, ?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([$mb['id'], $sieveScript, $enabled, $enabled, $subject, $body, $start, $end]);
    }

    try {
        if (!empty($mb['stalwart_account_id'])) {
            jmap('x:SieveScript/set', [
                'accountId' => (string)$mb['stalwart_account_id'],
                'create'    => [
                    'vac1' => [
                        'name'     => 'vacation',
                        'content'  => $sieveScript,
                        'isActive' => $enabled,
                    ],
                ],
            ]);
        }
    } catch (Throwable) {
    }

    ok([
        'mailbox'   => $mb['email'],
        'enabled'   => $enabled,
        'subject'   => $subject,
        'body'      => $body,
        'startDate' => $start,
        'endDate'   => $end,
    ]);
}

function clientPerformDnsCheck(string $domain): array
{
    $domain = strtolower($domain);
    $selector = 'affinmail';
    try {
        $pdo = db();
        $st = $pdo->prepare('SELECT * FROM domains WHERE domain_name = ?');
        $st->execute([$domain]);
        $domRow = $st->fetch();
        if ($domRow && !empty($domRow['dkim_selector'])) {
            $selector = $domRow['dkim_selector'];
        }
    } catch (Throwable) {
    }

    $expectedHost = cfg('MAIL_HOSTNAME', 'affinmail.hostaffin.com');

    $checks = [
        'mx'    => ['status' => 'missing', 'expected' => $expectedHost, 'records' => []],
        'spf'   => ['status' => 'missing', 'expected' => 'v=spf1 mx include:_spf.hostaffin.com ~all', 'record' => null],
        'dkim'  => ['status' => 'missing', 'selector' => $selector, 'record' => null],
        'dmarc' => ['status' => 'missing', 'expected' => 'v=DMARC1; p=quarantine', 'record' => null],
        'ptr'   => ['status' => 'valid', 'ip' => $_SERVER['SERVER_ADDR'] ?? '127.0.0.1', 'rdns' => $expectedHost],
    ];

    try {
        $mxRecords = @dns_get_record($domain, DNS_MX);
        if (is_array($mxRecords) && !empty($mxRecords)) {
            $checks['mx']['records'] = array_map(static fn($r) => $r['target'] ?? '', $mxRecords);
            foreach ($mxRecords as $mx) {
                if (strcasecmp((string)($mx['target'] ?? ''), $expectedHost) === 0 || str_contains((string)($mx['target'] ?? ''), 'hostaffin') || str_contains((string)($mx['target'] ?? ''), $domain)) {
                    $checks['mx']['status'] = 'valid';
                    break;
                }
            }
            if ($checks['mx']['status'] !== 'valid') {
                $checks['mx']['status'] = 'invalid';
            }
        }
    } catch (Throwable) {
    }

    try {
        $txtRecords = @dns_get_record($domain, DNS_TXT);
        if (is_array($txtRecords)) {
            foreach ($txtRecords as $txt) {
                $val = (string)($txt['txt'] ?? '');
                if (str_starts_with(strtolower($val), 'v=spf1')) {
                    $checks['spf']['record'] = $val;
                    $checks['spf']['status'] = (str_contains($val, 'include:') || str_contains($val, 'mx')) ? 'valid' : 'invalid';
                    break;
                }
            }
        }
    } catch (Throwable) {
    }

    try {
        $dkimRecords = @dns_get_record("{$selector}._domainkey.{$domain}", DNS_TXT);
        if (is_array($dkimRecords) && !empty($dkimRecords)) {
            foreach ($dkimRecords as $d) {
                $val = (string)($d['txt'] ?? '');
                if (str_contains($val, 'v=DKIM1') || str_contains($val, 'p=')) {
                    $checks['dkim']['record'] = $val;
                    $checks['dkim']['status'] = 'valid';
                    break;
                }
            }
            if ($checks['dkim']['status'] !== 'valid') {
                $checks['dkim']['status'] = 'invalid';
            }
        }
    } catch (Throwable) {
    }

    try {
        $dmarcRecords = @dns_get_record("_dmarc.{$domain}", DNS_TXT);
        if (is_array($dmarcRecords) && !empty($dmarcRecords)) {
            foreach ($dmarcRecords as $dm) {
                $val = (string)($dm['txt'] ?? '');
                if (str_starts_with(strtolower($val), 'v=dmarc1')) {
                    $checks['dmarc']['record'] = $val;
                    $checks['dmarc']['status'] = 'valid';
                    break;
                }
            }
            if ($checks['dmarc']['status'] !== 'valid') {
                $checks['dmarc']['status'] = 'invalid';
            }
        }
    } catch (Throwable) {
    }

    $allValid = ($checks['mx']['status'] === 'valid' &&
                 $checks['spf']['status'] === 'valid' &&
                 $checks['dkim']['status'] === 'valid' &&
                 $checks['dmarc']['status'] === 'valid');

    return [
        'domain'   => $domain,
        'allValid' => $allValid,
        'summary'  => [
            'mx'    => $checks['mx']['status'],
            'spf'   => $checks['spf']['status'],
            'dkim'  => $checks['dkim']['status'],
            'dmarc' => $checks['dmarc']['status'],
            'ptr'   => $checks['ptr']['status'],
        ],
        'checks'   => $checks,
    ];
}

function clientDnsCheck(string $domain): never
{
    $domain = strtolower($domain);
    $st = db()->prepare('SELECT 1 FROM domains WHERE domain_name = ?');
    $st->execute([$domain]);
    if (!$st->fetchColumn()) {
        apiFail(404, 'domain not found');
    }
    ok(clientPerformDnsCheck($domain));
}

function clientAutoconfig(string $domain): never
{
    $domain = strtolower($domain);
    $host = cfg('MAIL_HOSTNAME', 'mail.' . $domain);
    header('Content-Type: application/xml; charset=utf-8');
    echo <<<XML
<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="{$domain}">
    <domain>{$domain}</domain>
    <displayName>{$domain} Mail</displayName>
    <displayShortName>Mail</displayShortName>
    <incomingServer type="imap">
      <hostname>{$host}</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <incomingServer type="pop3">
      <hostname>{$host}</hostname>
      <port>995</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>{$host}</hostname>
      <port>465</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </outgoingServer>
    <outgoingServer type="smtp">
      <hostname>{$host}</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>
XML;
    exit;
}

function clientAutodiscover(string $domain): never
{
    $domain = strtolower($domain);
    $host = cfg('MAIL_HOSTNAME', 'mail.' . $domain);
    header('Content-Type: application/xml; charset=utf-8');
    echo <<<XML
<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">
  <Response xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a">
    <Account>
      <AccountType>email</AccountType>
      <Action>settings</Action>
      <Protocol>
        <Type>IMAP</Type>
        <Server>{$host}</Server>
        <Port>993</Port>
        <SSL>on</SSL>
        <AuthRequired>on</AuthRequired>
      </Protocol>
      <Protocol>
        <Type>SMTP</Type>
        <Server>{$host}</Server>
        <Port>465</Port>
        <SSL>on</SSL>
        <AuthRequired>on</AuthRequired>
      </Protocol>
    </Account>
  </Response>
</Autodiscover>
XML;
    exit;
}

function clientMobileconfig(string $domain): never
{
    $domain = strtolower($domain);
    $host = cfg('MAIL_HOSTNAME', 'mail.' . $domain);
    $uuid1 = bin2hex(random_bytes(16));
    $uuid2 = bin2hex(random_bytes(16));
    header('Content-Type: application/x-apple-aspen-config; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $domain . '.mobileconfig"');
    echo <<<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadDescription</key>
  <string>AffinMail configuration for {$domain}</string>
  <key>PayloadDisplayName</key>
  <string>{$domain} Mail</string>
  <key>PayloadIdentifier</key>
  <string>com.affinmail.profile.{$domain}</string>
  <key>PayloadOrganization</key>
  <string>AffinMail</string>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>{$uuid1}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>EmailAccountDescription</key>
      <string>{$domain} Mail</string>
      <key>EmailAccountType</key>
      <string>EmailTypeIMAP</string>
      <key>IncomingMailServerHostName</key>
      <string>{$host}</string>
      <key>IncomingMailServerPortNumber</key>
      <integer>993</integer>
      <key>IncomingMailServerUseSSL</key>
      <true/>
      <key>OutgoingMailServerHostName</key>
      <string>{$host}</string>
      <key>OutgoingMailServerPortNumber</key>
      <integer>465</integer>
      <key>OutgoingMailServerUseSSL</key>
      <true/>
      <key>PayloadIdentifier</key>
      <string>com.apple.mail.managed.{$uuid2}</string>
      <key>PayloadType</key>
      <string>com.apple.mail.managed</string>
      <key>PayloadUUID</key>
      <string>{$uuid2}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
</dict>
</plist>
XML;
    exit;
}

function clientMcpTokenList(string $id): never
{
    $mb = findMailbox($id);
    if (!$mb) {
        apiFail(404, 'mailbox not found');
    }
    ensureProvisioningTables();
    $st = db()->prepare(
        'SELECT id, token_prefix, name, scopes, created_at, expires_at, last_used_at
         FROM mcp_tokens
         WHERE mailbox_id = ?
         ORDER BY created_at DESC'
    );
    $st->execute([$mb['id']]);
    $rows = $st->fetchAll();
    ok([
        'mailbox' => $mb['email'],
        'tokens'  => array_map(static fn(array $r): array => [
            'id'         => $r['id'],
            'name'       => $r['name'],
            'prefix'     => $r['token_prefix'],
            'scopes'     => is_array($r['scopes'] ?? null) ? $r['scopes'] : (json_decode((string)($r['scopes'] ?? '[]'), true) ?: ['read', 'send', 'search']),
            'createdAt'  => $r['created_at'],
            'expiresAt'  => $r['expires_at'],
            'lastUsedAt' => $r['last_used_at'],
        ], $rows),
        'count'   => count($rows),
    ]);
}

function clientMcpTokenCreate(string $id): never
{
    $mb = findMailbox($id);
    if (!$mb) {
        apiFail(404, 'mailbox not found');
    }
    ensureProvisioningTables();
    $b = body();
    $name = stringField($b, 'name', 128);
    $scopes = is_array($b['scopes'] ?? null) && !empty($b['scopes']) ? $b['scopes'] : ['read', 'send', 'search'];
    $validScopes = array_values(array_filter($scopes, 'is_string'));
    $days = intField($b, 'expiresInDays', 90, 1, 3650);

    $rawToken = 'aff_mcp_' . bin2hex(random_bytes(20));
    $tokenHash = hash('sha256', $rawToken);
    $expiresAt = gmdate('Y-m-d\TH:i:s\Z', time() + $days * 86400);

    $scopesPg = '{' . implode(',', array_map(static fn($s) => '"' . addcslashes($s, '"\\') . '"', $validScopes)) . '}';

    $ins = db()->prepare(
        'INSERT INTO mcp_tokens (mailbox_id, token_hash, token_prefix, name, scopes, expires_at)
         VALUES (?, ?, \'aff_\', ?, ?::text[], ?) RETURNING *'
    );
    $ins->execute([$mb['id'], $tokenHash, $name, $scopesPg, $expiresAt]);
    $row = $ins->fetch();

    ok([
        'id'        => $row['id'],
        'name'      => $name,
        'scopes'    => $validScopes,
        'token'     => $rawToken,
        'prefix'    => 'aff_',
        'expiresAt' => $expiresAt,
        'createdAt' => $row['created_at'],
    ], 201);
}

function clientMcpTokenDelete(string $id, string $tid): never
{
    $mb = findMailbox($id);
    if (!$mb) {
        apiFail(404, 'mailbox not found');
    }
    ensureProvisioningTables();
    $st = db()->prepare('DELETE FROM mcp_tokens WHERE id::text = ? AND mailbox_id = ?');
    $st->execute([$tid, $mb['id']]);
    if ($st->rowCount() === 0) {
        apiFail(404, 'token not found');
    }
    ok(['deleted' => true, 'tokenId' => $tid]);
}

function clientMcpActivity(string $id): never
{
    $mb = findMailbox($id);
    if (!$mb) {
        apiFail(404, 'mailbox not found');
    }
    ensureProvisioningTables();
    $limit = isset($_GET['limit']) ? max(1, min(200, (int)$_GET['limit'])) : 50;
    $offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;

    $st = db()->prepare(
        'SELECT a.*, t.name AS token_name
         FROM mcp_audit_log a
         LEFT JOIN mcp_tokens t ON t.id = a.token_id
         WHERE a.mailbox_id = ?
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?'
    );
    $st->execute([$mb['id'], $limit, $offset]);
    $rows = $st->fetchAll();

    ok([
        'mailbox'  => $mb['email'],
        'activity' => array_map(static fn(array $r): array => [
            'id'         => $r['id'],
            'toolName'   => $r['tool_name'],
            'status'     => $r['status'],
            'tokenName'  => $r['token_name'] ?? null,
            'clientInfo' => is_array($r['client_info'] ?? null) ? $r['client_info'] : json_decode((string)($r['client_info'] ?? '{}'), true),
            'createdAt'  => $r['created_at'],
        ], $rows),
        'count'    => count($rows),
    ]);
}

function clientAppPasswordCreate(string $id): never
{
    $mb = findMailbox($id);
    if (!$mb) {
        apiFail(404, 'mailbox not found');
    }
    ensureProvisioningTables();
    $b = body();
    $label = stringField($b, 'label', 128);

    $raw = implode('-', str_split(bin2hex(random_bytes(8)), 4));
    $hash = password_hash($raw, PASSWORD_BCRYPT);

    $ins = db()->prepare('INSERT INTO app_passwords (mailbox_id, label, password_hash) VALUES (?, ?, ?) RETURNING *');
    $ins->execute([$mb['id'], $label, $hash]);
    $row = $ins->fetch();

    ok([
        'id'          => $row['id'],
        'label'       => $label,
        'appPassword' => $raw,
        'createdAt'   => $row['created_at'],
    ], 201);
}

function clientAppPasswordList(string $id): never
{
    $mb = findMailbox($id);
    if (!$mb) {
        apiFail(404, 'mailbox not found');
    }
    ensureProvisioningTables();
    $st = db()->prepare('SELECT id, label, created_at, last_used_at FROM app_passwords WHERE mailbox_id = ? ORDER BY created_at DESC');
    $st->execute([$mb['id']]);
    $rows = $st->fetchAll();

    ok([
        'mailbox'      => $mb['email'],
        'appPasswords' => array_map(static fn(array $r): array => [
            'id'         => $r['id'],
            'label'      => $r['label'],
            'createdAt'  => $r['created_at'],
            'lastUsedAt' => $r['last_used_at'],
        ], $rows),
        'count'        => count($rows),
    ]);
}

function clientAppPasswordDelete(string $id, ?string $pid = null): never
{
    $mb = findMailbox($id);
    if (!$mb) {
        apiFail(404, 'mailbox not found');
    }
    ensureProvisioningTables();
    if ($pid === null || $pid === '') {
        $b = body();
        $pid = is_string($b['id'] ?? null) ? $b['id'] : (is_string($_GET['id'] ?? null) ? $_GET['id'] : '');
    }
    if ($pid === '') {
        apiFail(400, 'password id is required');
    }

    $st = db()->prepare('DELETE FROM app_passwords WHERE id::text = ? AND mailbox_id = ?');
    $st->execute([$pid, $mb['id']]);
    if ($st->rowCount() === 0) {
        apiFail(404, 'app password not found');
    }
    ok(['deleted' => true, 'passwordId' => $pid]);
}

function authenticateClient(): array
{
    $reqPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    if (preg_match('#/(autoconfig|autodiscover|mobileconfig)$#', $reqPath) === 1) {
        return ['kind' => 'public', 'identifier' => $_SERVER['REMOTE_ADDR'] ?? 'guest'];
    }

    $given = bearer();
    $expected = cfg('AFFINMAIL_ADMIN_TOKEN');
    if ($expected !== '' && $given !== '' && hash_equals($expected, $given)) {
        return ['kind' => 'admin', 'identifier' => 'admin'];
    }
    if ($given !== '') {
        try {
            $sessUser = redis()->get('auth:session:' . hash('sha256', $given));
            if (is_string($sessUser) && $sessUser !== '') {
                return ['kind' => 'admin', 'identifier' => $sessUser];
            }
        } catch (Throwable) {
        }
        if (str_starts_with($given, 'aff_')) {
            try {
                $hash = hash('sha256', $given);
                $st = db()->prepare(
                    'SELECT m.id, m.email FROM mcp_tokens t
                     JOIN mailboxes m ON m.id = t.mailbox_id
                     WHERE t.token_hash = ? AND (t.expires_at IS NULL OR t.expires_at > NOW())'
                );
                $st->execute([$hash]);
                $row = $st->fetch();
                if ($row) {
                    db()->prepare('UPDATE mcp_tokens SET last_used_at = NOW() WHERE token_hash = ?')->execute([$hash]);
                    return ['kind' => 'mcp', 'identifier' => $row['email'], 'mailbox_id' => $row['id']];
                }
            } catch (Throwable) {
            }
        }
    }

    $basic = basicCredentials();
    if ($basic !== null && validEmail($basic['email'])) {
        try {
            $st = db()->prepare('SELECT * FROM mailboxes WHERE email = ?');
            $st->execute([strtolower($basic['email'])]);
            $mb = $st->fetch();
            if ($mb) {
                if (password_verify($basic['password'], $mb['password_hash'])) {
                    return ['kind' => 'mailbox', 'identifier' => $mb['email'], 'mailbox_id' => $mb['id']];
                }
                $appPwSt = db()->prepare('SELECT * FROM app_passwords WHERE mailbox_id = ?');
                $appPwSt->execute([$mb['id']]);
                foreach ($appPwSt->fetchAll() as $ap) {
                    if (password_verify($basic['password'], $ap['password_hash'])) {
                        db()->prepare('UPDATE app_passwords SET last_used_at = NOW() WHERE id = ?')->execute([$ap['id']]);
                        return ['kind' => 'mailbox', 'identifier' => $mb['email'], 'mailbox_id' => $mb['id']];
                    }
                }
            }
        } catch (Throwable) {
        }
    }

    apiFail(401, 'unauthorized');
}

/* ---------------------------------------------------------------- dispatch */

if (PHP_SAPI === 'cli' && !isset($_SERVER['REQUEST_METHOD']) && !in_array('--self-test-parsers', $argv ?? [], true)) {
    return;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = rtrim($path, '/');

if ($path === API_PREFIX . '/health' && $method === 'GET') {
    healthCheck();
}

if (!str_starts_with($path, API_PREFIX . '/')) {
    fail(404, 'not found');
}

if ($path === API_PREFIX . '/auth/login' && $method === 'POST') {
    adminLogin();
}

if ($path === API_PREFIX . '/auth/sso-exchange' && $method === 'POST') {
    ssoExchange();
}

$isImport = str_starts_with($path, API_PREFIX . '/import/');
$isProvision = str_starts_with($path, API_PREFIX . '/provision/');
$isClient = str_starts_with($path, API_PREFIX . '/client/');

if ($isImport) {
    $GLOBALS['import_identity'] = authenticateImport();
    rateLimit((string)($GLOBALS['import_identity']['username'] ?? bearer()));
} elseif ($isClient) {
    $GLOBALS['client_identity'] = authenticateClient();
    rateLimit((string)($GLOBALS['client_identity']['identifier'] ?? bearer()));
} else {
    $token = authenticate();
    rateLimit($token);
}
$GLOBALS['audit'] = [
    'agent'  => $_SERVER['HTTP_X_AGENT_ID'] ?? 'unknown',
    'method' => $method,
    'path'   => $path,
];

$seg = array_map('rawurldecode', explode('/', substr($path, strlen(API_PREFIX) + 1)));
$n = count($seg);

try {
    switch (true) {
        // domains
        case $n === 1 && $seg[0] === 'domains' && $method === 'GET':
            domainList();
        case $n === 1 && $seg[0] === 'domains' && $method === 'POST':
            domainCreate();
        case $n === 2 && $seg[0] === 'domains' && $method === 'GET':
            domainGet($seg[1]);
        case $n === 2 && $seg[0] === 'domains' && $method === 'DELETE':
            domainDelete($seg[1]);
        case $n === 3 && $seg[0] === 'domains' && $seg[2] === 'dns' && $method === 'GET':
            domainDns($seg[1]);

        // mailboxes
        case $n === 1 && $seg[0] === 'mailboxes' && $method === 'GET':
            mailboxList();
        case $n === 1 && $seg[0] === 'mailboxes' && $method === 'POST':
            mailboxCreate();
        case $n === 2 && $seg[0] === 'mailboxes' && $method === 'GET':
            mailboxGet($seg[1]);
        case $n === 2 && $seg[0] === 'mailboxes' && $method === 'DELETE':
            mailboxDelete($seg[1]);
        case $n === 3 && $seg[0] === 'mailboxes' && $seg[2] === 'quota' && $method === 'PATCH':
            mailboxQuota($seg[1]);
        case $n === 3 && $seg[0] === 'mailboxes' && $seg[2] === 'status' && $method === 'PUT':
            mailboxStatus($seg[1]);
        case $n === 3 && $seg[0] === 'mailboxes' && $seg[2] === 'password' && $method === 'PUT':
            mailboxPassword($seg[1]);

        // aliases
        case $n === 1 && $seg[0] === 'aliases' && $method === 'GET':
            aliasList();
        case $n === 1 && $seg[0] === 'aliases' && $method === 'POST':
            aliasCreate();
        case $n === 2 && $seg[0] === 'aliases' && $method === 'DELETE':
            aliasDelete($seg[1]);

        // mail queue
        case $n === 1 && $seg[0] === 'queue' && $method === 'GET':
            queueList();
        case $n === 2 && $seg[0] === 'queue' && $method === 'DELETE':
            queueDelete($seg[1]);
        case $n === 3 && $seg[0] === 'queue' && $seg[2] === 'retry' && $method === 'POST':
            queueRetry($seg[1]);

        // deliverability, catch-all, dkim rotation
        case $n === 3 && $seg[0] === 'domains' && $seg[2] === 'deliverability' && $method === 'GET':
            domainDeliverability($seg[1]);
        case $n === 3 && $seg[0] === 'domains' && $seg[2] === 'catch-all' && $method === 'PUT':
            domainCatchAll($seg[1]);
        case $n === 3 && $seg[0] === 'domains' && $seg[2] === 'dkim-rotate' && $method === 'POST':
            domainDkimRotate($seg[1]);

        // mail tracking and service logs
        case $n === 2 && $seg[0] === 'mail' && $seg[1] === 'track' && $method === 'GET':
            mailTrack();
        case $n === 2 && $seg[0] === 'system' && $seg[1] === 'logs' && $method === 'GET':
            systemLogs();

        // overview stats
        case $n === 1 && $seg[0] === 'stats' && $method === 'GET':
            statsOverview();

        // ip pools
        case $n === 1 && ($seg[0] === 'ip-pools' || $seg[0] === 'ippools') && $method === 'GET':
            ipPoolList();
        case $n === 1 && $seg[0] === 'ip-pools' && $method === 'POST':
            ipPoolCreate();
        case $n === 2 && $seg[0] === 'ippools' && $seg[1] === 'assign' && $method === 'POST':
            ipPoolAssign();

        // storage
        case $n === 1 && $seg[0] === 'storage' && $method === 'GET':
            storageStatus();

        // backup
        case $n === 2 && $seg[0] === 'system' && $seg[1] === 'backup' && $method === 'POST':
            backupCreate();
        case $n === 1 && $seg[0] === 'backup' && $method === 'POST':
            backupCreate();

        // system restart
        case $n === 2 && $seg[0] === 'system' && $seg[1] === 'restart' && $method === 'POST':
            systemRestart();

        // sso
        case $n === 2 && $seg[0] === 'auth' && $seg[1] === 'sso-token' && $method === 'POST':
            ssoToken();
        case $n === 2 && $seg[0] === 'auth' && $seg[1] === 'logout' && $method === 'POST':
            adminLogout();

        // import / migration
        case $n === 2 && $seg[0] === 'import' && $seg[1] === 'mbox' && $method === 'POST':
            importMbox();
        case $n === 2 && $seg[0] === 'import' && $seg[1] === 'eml' && $method === 'POST':
            importEml();
        case $n === 2 && $seg[0] === 'import' && $seg[1] === 'imap' && $method === 'POST':
            importImap();
        case $n === 2 && $seg[0] === 'import' && $seg[1] === 'jobs' && $method === 'GET':
            importJobList();
        case $n === 3 && $seg[0] === 'import' && $seg[1] === 'jobs' && $method === 'GET':
            importJobGet($seg[2]);

        // ---------------------------------------------------------------- provision api
        case $n === 2 && $seg[0] === 'provision' && $seg[1] === 'accounts' && $method === 'POST':
            provisionAccountCreate();
        case $n === 2 && $seg[0] === 'provision' && $seg[1] === 'accounts' && $method === 'GET':
            provisionAccountList();
        case $n === 3 && $seg[0] === 'provision' && $seg[1] === 'accounts' && $method === 'GET':
            provisionAccountGet($seg[2]);
        case $n === 3 && $seg[0] === 'provision' && $seg[1] === 'accounts' && $method === 'DELETE':
            provisionAccountDelete($seg[2]);
        case $n === 4 && $seg[0] === 'provision' && $seg[1] === 'accounts' && $seg[3] === 'plan' && $method === 'PUT':
            provisionAccountPlan($seg[2]);
        case $n === 4 && $seg[0] === 'provision' && $seg[1] === 'accounts' && $seg[3] === 'suspend' && $method === 'POST':
            provisionAccountSuspend($seg[2]);
        case $n === 4 && $seg[0] === 'provision' && $seg[1] === 'accounts' && $seg[3] === 'unsuspend' && $method === 'POST':
            provisionAccountUnsuspend($seg[2]);
        case $n === 4 && $seg[0] === 'provision' && $seg[1] === 'accounts' && $seg[3] === 'terminate' && $method === 'POST':
            provisionAccountTerminate($seg[2]);
        case $n === 4 && $seg[0] === 'provision' && $seg[1] === 'accounts' && $seg[3] === 'domains' && $method === 'POST':
            provisionDomainAdd($seg[2]);
        case $n === 4 && $seg[0] === 'provision' && $seg[1] === 'accounts' && $seg[3] === 'domains' && $method === 'GET':
            provisionDomainList($seg[2]);
        case $n === 5 && $seg[0] === 'provision' && $seg[1] === 'accounts' && $seg[3] === 'domains' && $method === 'DELETE':
            provisionDomainRemove($seg[2], $seg[4]);
        case $n === 4 && $seg[0] === 'provision' && $seg[1] === 'accounts' && $seg[3] === 'usage' && $method === 'GET':
            provisionAccountUsage($seg[2]);
        case $n === 4 && $seg[0] === 'provision' && $seg[1] === 'accounts' && $seg[3] === 'quota' && $method === 'GET':
            provisionAccountQuota($seg[2]);
        case $n === 3 && $seg[0] === 'provision' && $seg[1] === 'sso' && $seg[2] === 'token' && $method === 'POST':
            provisionSsoToken();
        case $n === 2 && $seg[0] === 'provision' && $seg[1] === 'plans' && $method === 'GET':
            provisionPlanList();
        case $n === 3 && $seg[0] === 'provision' && $seg[1] === 'plans' && $method === 'GET':
            provisionPlanGet($seg[2]);

        // ---------------------------------------------------------------- client self-service api
        case $n === 2 && $seg[0] === 'client' && $seg[1] === 'dashboard' && $method === 'GET':
            clientDashboard();
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'domains' && $seg[3] === 'mailboxes' && $method === 'GET':
            clientMailboxList($seg[2]);
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'domains' && $seg[3] === 'mailboxes' && $method === 'POST':
            clientMailboxCreate($seg[2]);
        case $n === 3 && $seg[0] === 'client' && $seg[1] === 'mailboxes' && $method === 'PUT':
            clientMailboxUpdate($seg[2]);
        case $n === 3 && $seg[0] === 'client' && $seg[1] === 'mailboxes' && $method === 'DELETE':
            clientMailboxDelete($seg[2]);
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'mailboxes' && $seg[3] === 'password' && ($method === 'PUT' || $method === 'POST'):
            clientMailboxPassword($seg[2]);
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'domains' && $seg[3] === 'aliases' && $method === 'GET':
            clientAliasList($seg[2]);
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'domains' && $seg[3] === 'aliases' && $method === 'POST':
            clientAliasCreate($seg[2]);
        case $n === 3 && $seg[0] === 'client' && $seg[1] === 'aliases' && $method === 'DELETE':
            clientAliasDelete($seg[2]);
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'mailboxes' && $seg[3] === 'forwarding' && $method === 'GET':
            clientForwardingGet($seg[2]);
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'mailboxes' && $seg[3] === 'forwarding' && $method === 'PUT':
            clientForwardingUpdate($seg[2]);
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'mailboxes' && $seg[3] === 'autoresponder' && $method === 'GET':
            clientAutoresponderGet($seg[2]);
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'mailboxes' && $seg[3] === 'autoresponder' && $method === 'PUT':
            clientAutoresponderUpdate($seg[2]);
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'domains' && $seg[3] === 'dns-check' && $method === 'GET':
            clientDnsCheck($seg[2]);
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'domains' && $seg[3] === 'autoconfig' && $method === 'GET':
            clientAutoconfig($seg[2]);
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'domains' && $seg[3] === 'autodiscover' && $method === 'GET':
            clientAutodiscover($seg[2]);
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'domains' && $seg[3] === 'mobileconfig' && $method === 'GET':
            clientMobileconfig($seg[2]);
        case $n === 5 && $seg[0] === 'client' && $seg[1] === 'mailboxes' && $seg[3] === 'mcp' && $seg[4] === 'tokens' && $method === 'GET':
            clientMcpTokenList($seg[2]);
        case $n === 5 && $seg[0] === 'client' && $seg[1] === 'mailboxes' && $seg[3] === 'mcp' && $seg[4] === 'tokens' && $method === 'POST':
            clientMcpTokenCreate($seg[2]);
        case $n === 6 && $seg[0] === 'client' && $seg[1] === 'mailboxes' && $seg[3] === 'mcp' && $seg[4] === 'tokens' && $method === 'DELETE':
            clientMcpTokenDelete($seg[2], $seg[5]);
        case $n === 5 && $seg[0] === 'client' && $seg[1] === 'mailboxes' && $seg[3] === 'mcp' && $seg[4] === 'activity' && $method === 'GET':
            clientMcpActivity($seg[2]);
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'mailboxes' && $seg[3] === 'app-passwords' && $method === 'POST':
            clientAppPasswordCreate($seg[2]);
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'mailboxes' && $seg[3] === 'app-passwords' && $method === 'GET':
            clientAppPasswordList($seg[2]);
        case $n === 4 && $seg[0] === 'client' && $seg[1] === 'mailboxes' && $seg[3] === 'app-passwords' && $method === 'DELETE':
            clientAppPasswordDelete($seg[2], null);
        case $n === 5 && $seg[0] === 'client' && $seg[1] === 'mailboxes' && $seg[3] === 'app-passwords' && $method === 'DELETE':
            clientAppPasswordDelete($seg[2], $seg[4]);

        default:
            fail(404, 'not found');
    }
} catch (PDOException $e) {
    fail(500, 'database error: ' . $e->getMessage());
} catch (RuntimeException $e) {
    fail(500, $e->getMessage());
}
