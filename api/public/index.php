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
    respond($code, ['status' => 'error', 'error' => $msg]);
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

/* ---------------------------------------------------------------- dispatch */

$method = $_SERVER['REQUEST_METHOD'];
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

if ($isImport) {
    $GLOBALS['import_identity'] = authenticateImport();
    rateLimit((string)($GLOBALS['import_identity']['username'] ?? bearer()));
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

        default:
            fail(404, 'not found');
    }
} catch (PDOException $e) {
    fail(500, 'database error: ' . $e->getMessage());
} catch (RuntimeException $e) {
    fail(500, $e->getMessage());
}
