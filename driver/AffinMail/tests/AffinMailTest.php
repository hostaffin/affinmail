<?php
/**
 * PHPUnit Test Suite for AffinMail Driver Module
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
            'serverhostname' => 'mail.hostaffin.com',
            'serverport' => '8080',
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
}
