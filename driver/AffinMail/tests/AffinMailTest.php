<?php
/**
 * PHPUnit Test Suite for AffinMail Driver Module
 *
 * Network tests target the LOCAL AffinMail API (127.0.0.1:8090). When the API
 * rejects the placeholder key the driver falls back to its locally signed SSO
 * token, so no external host is contacted.
 */

require_once __DIR__ . '/../AffinMail.php';

use PHPUnit\Framework\TestCase;

class AffinMailTest extends TestCase
{
    private $testParams;

    protected function setUp(): void
    {
        $this->testParams = [
            'domain' => 'testcompany.com',
            'username' => 'admin',
            'password' => 'SecurePass1234!',
            'serviceid' => 9912,
            'serverhostname' => '127.0.0.1',
            'serverport' => '8090',
            'serveraccesshash' => 'dummy_secret_hash',
            'configoption1' => '10240', // 10GB
            'configoption2' => '5',     // 5 mailboxes
            'configoption3' => '25',    // 25MB attachment
            'configoption4' => '200',   // 200/hr
            'configoption5' => 'direct',
            'configoption6' => 'shared',
            'clientsdetails' => [
                'fullname' => 'Test Administrator'
            ]
        ];
    }

    public function testMetaDataStructure()
    {
        $meta = affinmail_MetaData();
        $this->assertIsArray($meta);
        $this->assertEquals('AffinMail Modern Enterprise Mail', $meta['DisplayName']);
        $this->assertTrue($meta['RequiresServer']);
        $this->assertArrayHasKey('ServiceSingleSignOnLabel', $meta);
    }

    public function testConfigOptionsSchema()
    {
        $options = affinmail_ConfigOptions();
        $this->assertIsArray($options);
        $this->assertArrayHasKey('disk_quota_mb', $options);
        $this->assertArrayHasKey('max_attachment_size_mb', $options);
        $this->assertArrayHasKey('hourly_email_limit', $options);
        $this->assertArrayHasKey('outbound_route', $options);
        $this->assertArrayHasKey('ip_assignment', $options);
    }

    public function testAdminAndClientButtonArrays()
    {
        $adminButtons = affinmail_AdminCustomButtonArray();
        $this->assertIsArray($adminButtons);
        $this->assertArrayHasKey('Re-generate DKIM Keys', $adminButtons);

        $clientButtons = affinmail_ClientAreaCustomButtonArray();
        $this->assertIsArray($clientButtons);
        $this->assertArrayHasKey('Launch Webmail', $clientButtons);
    }

    public function testGenerateSsoTokenReturnsValidUrl()
    {
        $result = affinmail_GenerateSsoToken($this->testParams);
        $this->assertIsArray($result);
        $this->assertArrayHasKey('ssoUrl', $result);
        $this->assertStringContainsString('token=', $result['ssoUrl']);
        $this->assertStringNotContainsString('mail.hostaffin.com:8080', $result['ssoUrl']);
    }

    public function testClientAreaReturnsExpectedTemplateVars()
    {
        $result = affinmail_ClientArea($this->testParams);
        $this->assertIsArray($result);
        $this->assertEquals('templates/clientarea.tpl', $result['tabOverviewReplacementTemplate']);
        $this->assertArrayHasKey('dnsRecords', $result['templateVariables']);
        $this->assertArrayHasKey('ssoUrl', $result['templateVariables']);
        $this->assertEquals('testcompany.com', $result['templateVariables']['domain']);
    }

    public function testTestConnectionAgainstLocalApi()
    {
        $socket = @fsockopen('127.0.0.1', 8090, $errno, $errstr, 1);
        if (!$socket) {
            $this->markTestSkipped('Local AffinMail API not listening on 127.0.0.1:8090');
        }
        fclose($socket);

        $result = affinmail_TestConnection($this->testParams);
        $this->assertTrue($result['success'], 'Local API health check failed: ' . ($result['error'] ?? ''));
    }

    public function testSuspendAccountReturnsErrorStringOnFailure()
    {
        // Unreachable local port: apiCall fails, SuspendAccount must surface the error
        // string instead of reporting success.
        $params = $this->testParams;
        $params['serverport'] = '1';

        $result = affinmail_SuspendAccount($params);
        $this->assertIsString($result);
        $this->assertNotEquals('success', $result);
        $this->assertNotSame('', trim($result));
    }

    public function testMailboxEmailIsUrlEncoded()
    {
        $this->assertEquals('admin%40testcompany.com', affinmail_mailboxEmail($this->testParams));
    }

    public function testBase64UrlHasNoPadding()
    {
        $encoded = affinmail_base64url('any carnal pleasure.');
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]+$/', $encoded);
        $this->assertStringNotContainsString('=', $encoded);
    }
}
