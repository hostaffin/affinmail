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
    ok(domainOut($row));
}

function domainDns(string $name): never
{
    $st = db()->prepare('SELECT * FROM domains WHERE domain_name = ?');
    $st->execute([strtolower($name)]);
    $row = $st->fetch();
    if (!$row) {
        fail(404, 'domain not found');
    }
    $pub = $row['dkim_public_key'];
    ok([
        'domain'  => $row['domain_name'],
        'records' => [
            ['type' => 'MX', 'name' => '@', 'value' => 'affinmail.hostaffin.com', 'priority' => 10],
            ['type' => 'TXT', 'name' => '@', 'value' => 'v=spf1 mx include:_spf.hostaffin.com ~all'],
            ['type' => 'TXT', 'name' => $row['dkim_selector'] . '._domainkey', 'value' => 'v=DKIM1; k=rsa; p=' . $pub],
            ['type' => 'TXT', 'name' => '_dmarc', 'value' => 'v=DMARC1; p=quarantine; rua=mailto:dmarc@' . $row['domain_name']],
        ],
    ]);
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
    ok(['mailboxes' => array_map('mailboxOut', $rows), 'count' => count($rows)]);
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
    if (empty($row['stalwart_account_id']) || empty($row['secret_vault'])) {
        fail(409, 'mailbox was not provisioned through this API (missing Stalwart account/vault)');
    }

    try {
        $secret = $status === 'suspended'
            ? substr(bin2hex(random_bytes(20)), 0, 32)
            : vaultDecrypt($row['secret_vault']);
        stalwartSetPassword((string)$row['stalwart_account_id'], $secret);
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

/* ---------------------------------------------------------------- sso */

function ssoToken(): never
{
    $b = body();
    $email = strtolower(stringField($b, 'email'));
    if (!validEmail($email)) {
        fail(400, 'invalid email address');
    }
    $ttl = intField($b, 'ttlSeconds', 120, 30, 86400);

    $st = db()->prepare('SELECT 1 FROM mailboxes WHERE email = ?');
    $st->execute([$email]);
    if (!$st->fetchColumn()) {
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
    $expected = cfg('AFFINMAIL_ADMIN_TOKEN');
    $given = bearer();
    if ($expected === '' || $given === '' || !hash_equals($expected, $given)) {
        fail(401, 'unauthorized');
    }
    return $given;
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

$token = authenticate();
rateLimit($token);
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

        // aliases
        case $n === 1 && $seg[0] === 'aliases' && $method === 'GET':
            aliasList();
        case $n === 1 && $seg[0] === 'aliases' && $method === 'POST':
            aliasCreate();
        case $n === 2 && $seg[0] === 'aliases' && $method === 'DELETE':
            aliasDelete($seg[1]);

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

        // sso
        case $n === 2 && $seg[0] === 'auth' && $seg[1] === 'sso-token' && $method === 'POST':
            ssoToken();

        default:
            fail(404, 'not found');
    }
} catch (PDOException $e) {
    fail(500, 'database error: ' . $e->getMessage());
} catch (RuntimeException $e) {
    fail(500, $e->getMessage());
}
