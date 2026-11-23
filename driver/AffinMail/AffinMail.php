<?php
/**
 * AffinMail Server Provisioning Module for Hostaffin / WHMCS
 *
 * Implements 20 Standard Lifecycle Methods, 1-Click Passwordless SSO,
 * Plan-Driven Quota & Attachment Guards, and Multi-IP Assignment.
 *
 * @version 1.0.0
 * @author AffinMail Engineering
 */

if (!defined("WHMCS")) {
    // Permitted for standalone CLI/PHPUnit test execution
}

/**
 * 1. Module MetaData
 */
function affinmail_MetaData()
{
    return [
        'DisplayName' => 'AffinMail Modern Enterprise Mail',
        'APIVersion' => '1.1',
        'RequiresServer' => true,
        'DefaultNonSSLPort' => '8080',
        'DefaultSSLPort' => '8080',
        'ServiceSingleSignOnLabel' => 'Login to AffinMail Webmail',
        'AdminSingleSignOnLabel' => 'Login to Stalwart Admin Console',
    ];
}

/**
 * 2. Package Configuration Options (Hostaffin Product Setup)
 */
function affinmail_ConfigOptions()
{
    return [
        'disk_quota_mb' => [
            'FriendlyName' => 'Storage Quota (MB)',
            'Type' => 'text',
            'Size' => '10',
            'Default' => '10240',
            'Description' => 'Storage limit per mailbox in MB (e.g. 10240 = 10GB)',
        ],
        'max_mailboxes' => [
            'FriendlyName' => 'Maximum Mailboxes',
            'Type' => 'text',
            'Size' => '5',
            'Default' => '5',
            'Description' => 'Allowed mailboxes for this domain (0 for unlimited)',
        ],
        'max_attachment_size_mb' => [
            'FriendlyName' => 'Max Attachment Size (MB)',
            'Type' => 'dropdown',
            'Options' => '15,25,50,100',
            'Default' => '25',
            'Description' => 'Enforced attachment limit per message',
        ],
        'hourly_email_limit' => [
            'FriendlyName' => 'Hourly Sending Rate',
            'Type' => 'text',
            'Size' => '5',
            'Default' => '200',
            'Description' => 'Outbound rate limit per mailbox per hour',
        ],
        'outbound_route' => [
            'FriendlyName' => 'Outbound Route',
            'Type' => 'dropdown',
            'Options' => 'direct,relay_ses,relay_sendgrid,relay_custom',
            'Default' => 'direct',
            'Description' => 'SmartHost routing policy for this hosting plan',
        ],
        'ip_assignment' => [
            'FriendlyName' => 'IP Allocation Policy',
            'Type' => 'dropdown',
            'Options' => 'shared,dedicated',
            'Default' => 'shared',
            'Description' => 'Allocate from shared IP pool or assign dedicated outbound IPv4',
        ],
    ];
}

/**
 * Internal API Client Helper
 */
function affinmail_apiCall($params, $endpoint, $method = 'GET', $data = [])
{
    $serverHost = !empty($params['serverhostname']) ? $params['serverhostname'] : $params['serverip'];
    $serverPort = !empty($params['serverport']) ? $params['serverport'] : '8080';
    $apiKey = !empty($params['serveraccesshash']) ? $params['serveraccesshash'] : $params['serverpassword'];
    $protocol = !empty($params['serversecure']) ? 'https' : 'http';

    $url = "{$protocol}://{$serverHost}:{$serverPort}/api/v1/{$endpoint}";

    $headers = [
        'Content-Type: application/json',
        'Accept: application/json',
        "X-Server-API-Key: {$apiKey}"
    ];

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    } elseif ($method === 'PUT' || $method === 'PATCH' || $method === 'DELETE') {
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    }

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError) {
        return ['success' => false, 'error' => "cURL Error: {$curlError}"];
    }

    $decoded = json_decode($response, true);
    $apiError = is_array($decoded) ? ($decoded['error'] ?? $decoded['message'] ?? null) : null;

    if ($httpCode >= 200 && $httpCode < 300 && ($decoded['status'] ?? 'success') !== 'error') {
        $payload = (is_array($decoded) && array_key_exists('data', $decoded)) ? $decoded['data'] : $decoded;
        return ['success' => true, 'data' => $payload, 'code' => $httpCode];
    }

    return ['success' => false, 'error' => $apiError ?? "HTTP {$httpCode} Response", 'code' => $httpCode];
}

/**
 * Encoded mailbox path segment for API calls
 */
function affinmail_mailboxEmail(array $params)
{
    $domain = strtolower(trim($params['domain']));
    return rawurlencode("{$params['username']}@{$domain}");
}

/**
 * 3. CreateAccount Method
 */
function affinmail_CreateAccount(array $params)
{
    $domain = strtolower(trim($params['domain']));
    $username = $params['username'];
    $password = $params['password'];
    $email = "{$username}@{$domain}";

    $diskQuotaMb = (int)($params['configoption1'] ?? 10240);
    $maxMailboxes = (int)($params['configoption2'] ?? 5);
    $maxAttachmentMb = (int)($params['configoption3'] ?? 25);
    $hourlyRate = (int)($params['configoption4'] ?? 200);
    $outboundRoute = $params['configoption5'] ?? 'direct';
    $ipPolicy = $params['configoption6'] ?? 'shared';

    // Step 1: Provision Domain in Stalwart Engine
    $domainPayload = [
        'domain' => $domain,
        'diskQuotaMb' => $diskQuotaMb,
        'maxMailboxes' => $maxMailboxes,
        'maxAttachmentMb' => $maxAttachmentMb,
        'ipPolicy' => $ipPolicy,
        'hostaffinServiceId' => $params['serviceid'] ?? null
    ];

    $domainResult = affinmail_apiCall($params, 'domains', 'POST', $domainPayload);
    if (!$domainResult['success'] && ($domainResult['code'] ?? 0) !== 409) {
        return "Failed to create domain: " . $domainResult['error'];
    }

    // Step 2: Provision Primary Admin Mailbox
    $mailboxPayload = [
        'email' => $email,
        'username' => $username,
        'password' => $password,
        'displayName' => $params['clientsdetails']['fullname'] ?? ucfirst($username),
        'quotaLimitMb' => $diskQuotaMb,
        'hourlyRateLimit' => $hourlyRate,
        'outboundRoute' => $outboundRoute,
        'isAdmin' => true
    ];

    $mailboxResult = affinmail_apiCall($params, 'mailboxes', 'POST', $mailboxPayload);
    if (!$mailboxResult['success']) {
        return "Failed to create primary mailbox: " . $mailboxResult['error'];
    }

    return 'success';
}

/**
 * 4. SuspendAccount Method
 */
function affinmail_SuspendAccount(array $params)
{
    $email = affinmail_mailboxEmail($params);
    $result = affinmail_apiCall($params, "mailboxes/{$email}/status", 'PUT', ['status' => 'suspended']);
    return $result['success'] ? 'success' : $result['error'];
}

/**
 * 5. UnsuspendAccount Method
 */
function affinmail_UnsuspendAccount(array $params)
{
    $email = affinmail_mailboxEmail($params);
    $result = affinmail_apiCall($params, "mailboxes/{$email}/status", 'PUT', ['status' => 'active']);
    return $result['success'] ? 'success' : $result['error'];
}

/**
 * 6. TerminateAccount Method
 */
function affinmail_TerminateAccount(array $params)
{
    $domain = strtolower(trim($params['domain']));
    $result = affinmail_apiCall($params, "domains/" . rawurlencode($domain), 'DELETE');
    return $result['success'] ? 'success' : $result['error'];
}

/**
 * 7. ChangePassword Method
 */
function affinmail_ChangePassword(array $params)
{
    $email = affinmail_mailboxEmail($params);
    $result = affinmail_apiCall($params, "mailboxes/{$email}/password", 'POST', ['password' => $params['password']]);
    return $result['success'] ? 'success' : $result['error'];
}

/**
 * 8. ChangePackage Method
 */
function affinmail_ChangePackage(array $params)
{
    $email = affinmail_mailboxEmail($params);
    $payload = [
        'quotaLimitMb' => (int)($params['configoption1'] ?? 10240),
        'hourlyRateLimit' => (int)($params['configoption4'] ?? 200),
        'outboundRoute' => $params['configoption5'] ?? 'direct',
    ];
    $result = affinmail_apiCall($params, "mailboxes/{$email}/quota", 'PATCH', $payload);
    return $result['success'] ? 'success' : $result['error'];
}

/**
 * 9. TestConnection Method
 */
function affinmail_TestConnection(array $params)
{
    $result = affinmail_apiCall($params, 'health', 'GET');
    if ($result['success']) {
        return ['success' => true];
    }
    return ['success' => false, 'error' => $result['error']];
}

/**
 * 10. UsageUpdate Method (Nightly Cron)
 */
function affinmail_UsageUpdate(array $params)
{
    $result = affinmail_apiCall($params, 'usage/summary', 'GET');
    if (!$result['success']) {
        return $result['error'];
    }

    $services = $result['data']['services'] ?? [];
    foreach ($services as $service) {
        $serviceId = $service['hostaffinServiceId'] ?? null;
        $diskUsedMb = (int)($service['diskUsedMb'] ?? 0);
        $diskLimitMb = (int)($service['diskLimitMb'] ?? 0);

        if ($serviceId && function_exists('updateService')) {
            updateService([
                'serviceid' => $serviceId,
                'diskusage' => $diskUsedMb,
                'disklimit' => $diskLimitMb,
            ]);
        }
    }

    return 'success';
}

/**
 * 11. ClientArea Method (Renders Interactive DNS Widget & SSO Launch Button)
 */
function affinmail_ClientArea(array $params)
{
    $domain = strtolower(trim($params['domain']));
    $dnsResult = affinmail_apiCall($params, 'domains/' . rawurlencode($domain) . '/dns', 'GET');
    $ssoResult = affinmail_GenerateSsoToken($params);

    $dnsRecords = $dnsResult['success'] ? ($dnsResult['data']['records'] ?? []) : [];
    $dnsError = $dnsResult['success'] ? '' : ($dnsResult['error'] ?? 'DNS records unavailable');

    $isDedicatedIp = !empty($dnsResult['data']['isDedicatedIp']);
    $assignedIp = $dnsResult['data']['assignedIp'] ?? '';
    $rdnsHostname = $dnsResult['data']['rdnsHostname'] ?? '';

    return [
        'tabOverviewReplacementTemplate' => 'templates/clientarea.tpl',
        'templateVariables' => [
            'domain' => $domain,
            'dnsRecords' => $dnsRecords,
            'dnsError' => $dnsError,
            'ssoUrl' => $ssoResult['ssoUrl'] ?? null,
            'ssoError' => $ssoResult['error'] ?? '',
            'isDedicatedIp' => $isDedicatedIp,
            'assignedIp' => $assignedIp,
            'rdnsHostname' => $rdnsHostname,
            'webmailUrl' => "https://mail.hostaffin.com",
            'maxAttachmentMb' => $params['configoption3'] ?? 25,
            'diskQuotaMb' => $params['configoption1'] ?? 10240,
        ],
    ];
}

/**
 * 12. AdminServicesTabFields Method
 */
function affinmail_AdminServicesTabFields(array $params)
{
    $domain = strtolower(trim($params['domain']));
    $domainResult = affinmail_apiCall($params, 'domains/' . rawurlencode($domain), 'GET');
    $mailboxResult = affinmail_apiCall($params, 'mailboxes/' . affinmail_mailboxEmail($params), 'GET');

    $domainData = $domainResult['success'] ? ($domainResult['data'] ?? []) : [];
    $mailboxData = $mailboxResult['success'] ? ($mailboxResult['data'] ?? []) : [];

    $quotaUsed = isset($mailboxData['quotaUsedBytes']) ? round(((int)$mailboxData['quotaUsedBytes']) / 1048576, 1) : null;
    $quotaLimit = $mailboxData['quotaLimitMb'] ?? null;
    $storage = ($quotaUsed !== null && $quotaLimit !== null) ? "{$quotaUsed} MB / {$quotaLimit} MB" : 'Unavailable';

    $dkimSelector = $domainData['dkimSelector'] ?? '';
    $dkimPublicKey = $domainData['dkimPublicKey'] ?? '';
    $dkimStatus = !empty($dkimPublicKey)
        ? 'Active' . ($dkimSelector !== '' ? " (selector: {$dkimSelector})" : '')
        : 'Not configured';

    return [
        'Storage Consumption' => $storage,
        'Active Mailboxes' => $domainData['mailboxCount'] ?? 'Unavailable',
        'Domain Disk Quota' => isset($domainData['diskQuotaMb']) ? "{$domainData['diskQuotaMb']} MB" : 'Unavailable',
        'DKIM Signing Status' => $dkimStatus,
        'Mailbox Status' => $mailboxData['status'] ?? 'Unavailable',
    ];
}

/**
 * 13. AdminServicesTabFieldsSave Method
 */
function affinmail_AdminServicesTabFieldsSave(array $params)
{
    $quotaLimitMb = $params['quotaLimitMb']
        ?? $params['diskQuotaMb']
        ?? $params['disk_quota_mb']
        ?? $params['configoption1']
        ?? 10240;
    $hourlyRateLimit = $params['hourlyRateLimit'] ?? $params['configoption4'] ?? 200;
    $outboundRoute = $params['outboundRoute'] ?? $params['configoption5'] ?? 'direct';

    $result = affinmail_apiCall($params, 'mailboxes/' . affinmail_mailboxEmail($params) . '/quota', 'PATCH', [
        'quotaLimitMb' => (int)$quotaLimitMb,
        'hourlyRateLimit' => (int)$hourlyRateLimit,
        'outboundRoute' => $outboundRoute,
    ]);

    return $result['success'] ? 'success' : $result['error'];
}

/**
 * 14. LoginToControlPanel (Admin Console SSO)
 */
function affinmail_LoginToControlPanel(array $params)
{
    $serverHost = !empty($params['serverhostname']) ? $params['serverhostname'] : 'mail.hostaffin.com';
    return [
        'operatorRedirectUrl' => "https://{$serverHost}:8080/admin",
        'success' => true,
    ];
}

/**
 * 15. AdminCustomButtonArray Method
 */
function affinmail_AdminCustomButtonArray()
{
    return [
        "Re-generate DKIM Keys" => "SyncDkimRecords",
        "Flush Rate Limits" => "FlushRateLimits",
        "Sync Usage Now" => "UsageUpdate",
    ];
}

/**
 * 16. ClientAreaCustomButtonArray Method
 */
function affinmail_ClientAreaCustomButtonArray()
{
    return [
        "Launch Webmail" => "LoginToWebmail",
    ];
}

/**
 * 17. Renew Method
 */
function affinmail_Renew(array $params)
{
    $result = affinmail_apiCall($params, 'mailboxes/' . affinmail_mailboxEmail($params) . '/status', 'PUT', ['status' => 'active']);
    return $result['success'] ? 'success' : $result['error'];
}

/**
 * 18. GetEmailUsage Method
 */
function affinmail_GetEmailUsage(array $params)
{
    $domain = strtolower(trim($params['domain']));
    $result = affinmail_apiCall($params, "domains/{$domain}/mailboxes/usage", 'GET');
    return $result['data'] ?? [];
}

/**
 * 19. SyncDkimRecords Method
 */
function affinmail_SyncDkimRecords(array $params)
{
    $domain = strtolower(trim($params['domain']));
    $result = affinmail_apiCall($params, "domains/{$domain}/dkim/rotate", 'POST');
    return $result['success'] ? 'success' : $result['error'];
}

/**
 * 20. GenerateSsoToken Method (1-Click Passwordless JWT SSO)
 */
function affinmail_GenerateSsoToken(array $params)
{
    $domain = strtolower(trim($params['domain']));
    $email = "{$params['username']}@{$domain}";

    $result = affinmail_apiCall($params, 'auth/sso-token', 'POST', [
        'email' => $email,
        'ttlSeconds' => 120
    ]);

    if ($result['success'] && !empty($result['data']['ssoUrl'])) {
        return ['ssoUrl' => $result['data']['ssoUrl']];
    }

    $apiError = $result['error'] ?? 'SSO token request failed';
    $secret = !empty($params['serveraccesshash']) ? $params['serveraccesshash'] : ($params['serverpassword'] ?? '');

    if (empty($secret)) {
        return ['error' => $apiError];
    }

    // Locally signed fallback token (HMAC-SHA256), only when a server secret is configured
    $payload = affinmail_base64url(json_encode([
        'email' => $email,
        'exp' => time() + 120,
        'nonce' => bin2hex(random_bytes(16))
    ]));
    $token = $payload . '.' . affinmail_base64url(hash_hmac('sha256', $payload, $secret, true));

    return [
        'ssoUrl' => "https://mail.hostaffin.com/sso?token={$token}"
    ];
}

/**
 * Base64url encode helper
 */
function affinmail_base64url($data)
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

/**
 * 21. FlushRateLimits Method
 */
function affinmail_FlushRateLimits(array $params)
{
    $domain = strtolower(trim($params['domain']));
    $email = "{$params['username']}@{$domain}";

    $result = affinmail_apiCall($params, 'system/rate-limits/flush', 'POST', [
        'domain' => $domain,
        'email' => $email,
    ]);

    return $result['success'] ? 'success' : $result['error'];
}

/**
 * 22. LoginToWebmail Method
 */
function affinmail_LoginToWebmail(array $params)
{
    $sso = affinmail_GenerateSsoToken($params);
    if (empty($sso['ssoUrl'])) {
        return $sso['error'] ?? 'SSO token request failed';
    }

    return [
        'success' => true,
        'redirectTo' => $sso['ssoUrl'],
        'ssoUrl' => $sso['ssoUrl'],
    ];
}
