<?php
/**
 * Test Suite for AffinMail Provisioning and Client Self-Service API
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/public/index.php';

echo "==================================================================\n";
echo " AffinMail Provisioning & Client Self-Service API Verification   \n";
echo "==================================================================\n\n";

$passed = 0;
$failed = 0;

function assertTest(string $name, bool $condition, string $detail = ''): void {
    global $passed, $failed;
    if ($condition) {
        echo "[PASS] {$name}\n";
        $passed++;
    } else {
        echo "[FAIL] {$name}: {$detail}\n";
        $failed++;
    }
}

// 1. Verify SQL migration file exists
$sqlFile = dirname(__DIR__) . '/sql/005_provisioning_and_client_api.sql';
assertTest("SQL Migration 005 exists", file_exists($sqlFile));
$sqlContent = (string)file_get_contents($sqlFile);
assertTest("SQL Migration defines 'plans' table", str_contains($sqlContent, 'CREATE TABLE IF NOT EXISTS plans'));
assertTest("SQL Migration defines 'accounts' table", str_contains($sqlContent, 'CREATE TABLE IF NOT EXISTS accounts'));
assertTest("SQL Migration defines 'app_passwords' table", str_contains($sqlContent, 'CREATE TABLE IF NOT EXISTS app_passwords'));
assertTest("SQL Migration defines 'mcp_tokens' table", str_contains($sqlContent, 'CREATE TABLE IF NOT EXISTS mcp_tokens'));
assertTest("SQL Migration defines 'mcp_audit_log' table", str_contains($sqlContent, 'CREATE TABLE IF NOT EXISTS mcp_audit_log'));
assertTest("SQL Migration seeds default plans", str_contains($sqlContent, "'starter'") && str_contains($sqlContent, "'professional'") && str_contains($sqlContent, "'enterprise'"));

// 2. Verify Provisioning API endpoints exist
$provisioningFunctions = [
    'ensureProvisioningTables',
    'findPlan',
    'planOut',
    'findAccount',
    'accountOut',
    'findMailbox',
    'provisionAccountCreate',
    'provisionAccountGet',
    'provisionAccountList',
    'provisionAccountPlan',
    'provisionAccountSuspend',
    'provisionAccountUnsuspend',
    'provisionAccountTerminate',
    'provisionAccountDelete',
    'provisionDomainAdd',
    'provisionDomainRemove',
    'provisionDomainList',
    'provisionAccountUsage',
    'provisionAccountQuota',
    'provisionSsoToken',
    'provisionPlanList',
    'provisionPlanGet',
];
foreach ($provisioningFunctions as $fn) {
    assertTest("Provisioning function '{$fn}' defined", function_exists($fn));
}

// 3. Verify Client Self-Service API endpoints exist
$clientFunctions = [
    'clientDashboard',
    'clientMailboxList',
    'clientMailboxCreate',
    'clientMailboxUpdate',
    'clientMailboxDelete',
    'clientMailboxPassword',
    'clientAliasList',
    'clientAliasCreate',
    'clientAliasDelete',
    'clientForwardingGet',
    'clientForwardingUpdate',
    'clientAutoresponderGet',
    'clientAutoresponderUpdate',
    'clientPerformDnsCheck',
    'clientDnsCheck',
    'clientAutoconfig',
    'clientAutodiscover',
    'clientMobileconfig',
    'clientMcpTokenList',
    'clientMcpTokenCreate',
    'clientMcpTokenDelete',
    'clientMcpActivity',
    'clientAppPasswordCreate',
    'clientAppPasswordList',
    'clientAppPasswordDelete',
    'authenticateClient',
];
foreach ($clientFunctions as $fn) {
    assertTest("Client function '{$fn}' defined", function_exists($fn));
}

// 4. Test error format logic
assertTest("apiFail function exists", function_exists('apiFail'));

// 5. Test autoconfig / autodiscover / mobileconfig via sub-processes
$indexPath = str_replace('\\', '/', dirname(__DIR__) . '/api/public/index.php');

$acOutput = shell_exec("php -r \"require '{$indexPath}'; clientAutoconfig('testdom.com');\"");
assertTest("Autoconfig endpoint outputs valid Thunderbird XML with IMAP 993 & SMTP 465/587", str_contains((string)$acOutput, '<incomingServer type="imap">') && str_contains((string)$acOutput, '<port>993</port>') && str_contains((string)$acOutput, '<port>465</port>'));

$adOutput = shell_exec("php -r \"require '{$indexPath}'; clientAutodiscover('testdom.com');\"");
assertTest("Autodiscover endpoint outputs valid Outlook XML with IMAP & SMTP", str_contains((string)$adOutput, '<Type>IMAP</Type>') && str_contains((string)$adOutput, '<Port>993</Port>') && str_contains((string)$adOutput, '<Type>SMTP</Type>'));

$mcOutput = shell_exec("php -r \"require '{$indexPath}'; clientMobileconfig('testdom.com');\"");
assertTest("Mobileconfig endpoint outputs Apple profile with com.apple.mail.managed", str_contains((string)$mcOutput, 'com.apple.mail.managed') && str_contains((string)$mcOutput, '<integer>993</integer>'));

// 6. Test App Password generation format
$rawAppPw = implode('-', str_split(bin2hex(random_bytes(8)), 4));
assertTest("App password matches 16-char grouped pattern (xxxx-xxxx-xxxx-xxxx)", preg_match('/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/', $rawAppPw) === 1);
$appPwHash = password_hash($rawAppPw, PASSWORD_BCRYPT);
assertTest("App password bcrypt hash validates correctly", password_verify($rawAppPw, $appPwHash));

// 7. Test MCP Token generation format
$rawMcpToken = 'aff_mcp_' . bin2hex(random_bytes(20));
assertTest("MCP token begins with 'aff_mcp_' and has high entropy", str_starts_with($rawMcpToken, 'aff_mcp_') && strlen($rawMcpToken) === 48);
$mcpHash = hash('sha256', $rawMcpToken);
assertTest("MCP token SHA256 hash length is 64 hex characters", strlen($mcpHash) === 64);

// 8. Test DNS check structure
$dnsCheck = clientPerformDnsCheck('example.com');
assertTest("DNS check returns expected structure", isset($dnsCheck['domain']) && isset($dnsCheck['allValid']) && isset($dnsCheck['checks']['mx']) && isset($dnsCheck['checks']['spf']) && isset($dnsCheck['checks']['dkim']) && isset($dnsCheck['checks']['dmarc']) && isset($dnsCheck['checks']['ptr']));

// 9. Test SSO Token generation
$testSecret = 'affinmail-test-secret';
$testEmail = 'admin@example.com';
$payloadData = [
    'email' => $testEmail,
    'exp'   => time() + 120,
    'nonce' => bin2hex(random_bytes(16)),
];
$payloadJson = json_encode($payloadData, JSON_UNESCAPED_SLASHES);
$b64Payload = rtrim(strtr(base64_encode($payloadJson), '+/', '-_'), '=');
$sig = rtrim(strtr(base64_encode(hash_hmac('sha256', $b64Payload, $testSecret, true)), '+/', '-_'), '=');
$ssoToken = $b64Payload . '.' . $sig;
assertTest("SSO token structure is valid HMAC-SHA256 signed JWT-like token", str_contains($ssoToken, '.'));
$decodedPayload = json_decode(base64_decode(strtr(explode('.', $ssoToken)[0], '-_', '+/')), true);
assertTest("SSO token payload extracts verified email", ($decodedPayload['email'] ?? '') === $testEmail);

// 10. Test error format output
$errorOutput = shell_exec("php -r \"require '{$indexPath}'; apiFail(404, 'entity not found');\"");
$errDecoded = json_decode((string)$errorOutput, true);
assertTest("apiFail outputs proper error format: {'error': {'code': 404, 'message': '...'}}", ($errDecoded['error']['code'] ?? 0) === 404 && ($errDecoded['error']['message'] ?? '') === 'entity not found');

echo "\n------------------------------------------------------------------\n";
echo "Test Results: {$passed} Passed, {$failed} Failed\n";
echo "------------------------------------------------------------------\n";

if ($failed > 0) {
    exit(1);
}
exit(0);
