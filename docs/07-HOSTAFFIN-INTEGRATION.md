# AffinMail: Hostaffin Server Driver Module Specification

---

## 1. Module Overview
* **Module Name:** `AffinMail`
* **Driver Location:** `app/Modules/Servers/AffinMail/AffinMail.php`
* **Compatibility:** Hostaffin Billing Platform / WHMCS 8.x+ Standard Module Architecture
* **Purpose:** Fully automate the creation, suspension, package changes, quota synchronization, passwordless SSO, and DNS guidance for AffinMail accounts directly within Hostaffin.

---

## 2. Package Configuration Options (Hostaffin Admin)

When setting up an AffinMail Product/Service in Hostaffin, the administrator configures:

```php
function affinmail_ConfigOptions() {
    return [
        'disk_quota_mb' => [
            'FriendlyName' => 'Storage Quota (MB)',
            'Type' => 'text',
            'Size' => '10',
            'Default' => '10240',
            'Description' => 'Storage limit per mailbox in Megabytes (e.g. 10240 = 10GB)',
        ],
        'max_mailboxes' => [
            'FriendlyName' => 'Maximum Mailboxes',
            'Type' => 'text',
            'Size' => '5',
            'Default' => '5',
            'Description' => 'Number of permitted mailboxes for this domain (0 for unlimited)',
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
    ];
}
```

---

## 3. Implementation of the 20 Standard Lifecycle Methods

### Method 1: `affinmail_MetaData()`
Defines module requirements, displayName, and API versioning.

### Method 2: `affinmail_ConfigOptions()`
Exports custom package configuration inputs to the Hostaffin Product configuration page.

### Method 3: `affinmail_CreateAccount(array $params)`
1. Parses `domain`, `username`, `password`, and custom fields.
2. Invokes Stalwart REST API `POST /api/v1/domains` to create the domain.
3. Automatically provisions a 2048-bit DKIM keypair for the client domain.
4. Creates the primary administrator mailbox via `POST /api/v1/mailboxes`.
5. Sets initial quota, hourly rate limit, and outbound route.
6. Returns `'success'`.

### Method 4: `affinmail_SuspendAccount(array $params)`
Calls `PUT /api/v1/mailboxes/{email}/status` setting `status = 'suspended'`. Disables Webmail login, IMAP/POP3, and SMTP submission while allowing safe inbound mail queuing.

### Method 5: `affinmail_UnsuspendAccount(array $params)`
Calls `PUT /api/v1/mailboxes/{email}/status` setting `status = 'active'`, restoring all interactive email operations.

### Method 6: `affinmail_TerminateAccount(array $params)`
Calls `DELETE /api/v1/domains/{domain}`. Safely removes virtual domain, deletes mailboxes, and archives blobs per retention rules.

### Method 7: `affinmail_ChangePassword(array $params)`
Calls `POST /api/v1/mailboxes/{email}/password` with the newly generated password string, updated immediately across all daemons.

### Method 8: `affinmail_ChangePackage(array $params)`
Triggered when a customer upgrades/downgrades their plan in Hostaffin. Updates mailbox storage quota, attachment limits, and rate limits dynamically without mailbox recreation.

### Method 9: `affinmail_TestConnection(array $params)`
Pings Stalwart Admin REST API endpoint `GET /api/v1/health` with `serveraccesshash` / API key to verify connectivity from the Hostaffin server.

### Method 10: `affinmail_UsageUpdate(array $params)`
Executes via Hostaffin nightly cron:
1. Queries `GET /api/v1/usage/summary`.
2. Syncs consumed disk space and active mailbox count back into the Hostaffin `tblhosting` table for automated overage billing.

### Method 11: `affinmail_ClientArea(array $params)`
Injects the interactive AffinMail DNS record table and the 1-Click "Log into Webmail" SSO launcher button into the customer portal.

### Method 12: `affinmail_AdminServicesTabFields(array $params)`
Renders an administrative diagnostic panel inside Hostaffin Admin with live storage usage bars, active routing policy, and DKIM selector status.

### Method 13: `affinmail_AdminServicesTabFieldsSave(array $params)`
Saves admin manual overrides (e.g. manually flipping an account from `direct` to `relay_ses`).

### Method 14: `affinmail_LoginToControlPanel(array $params)`
Redirects Hostaffin administrator into the Stalwart Web Console using superadmin SSO.

### Method 15: `affinmail_AdminCustomButtonArray()`
Provides administrative action buttons: "Re-generate DKIM Keys", "Flush Rate Limit", "Sync Usage Now".

### Method 16: `affinmail_ClientAreaCustomButtonArray()`
Provides client quick actions: "Webmail Login", "View DNS Configuration".

### Method 17: `affinmail_Renew(array $params)`
Extends subscription validity; checks if account was suspended for non-payment and unsuspends automatically upon payment confirmation.

### Method 18: `affinmail_GetEmailUsage(array $params)`
Retrieves granular per-mailbox disk consumption breakdown for display in client dashboards.

### Method 19: `affinmail_SyncDkimRecords(array $params)`
Fetches newly rotated or created DKIM public keys from Stalwart and caches them in Hostaffin.

### Method 20: `affinmail_GenerateSsoToken(array $params)`
Calls Stalwart `POST /api/v1/auth/sso-token`, returns single-use signed JWT URL and redirects customer's browser.

---

## 4. Client Area Interactive DNS Widget Blueprint

```html
<div class="card bg-base-100 shadow border border-base-200 p-6 my-4">
  <div class="flex items-center justify-between mb-4">
    <h3 class="text-lg font-bold">Required DNS Records for AffinMail</h3>
    <a href="{$ssoUrl}" target="_blank" class="btn btn-primary btn-sm">
      <svg>...</svg> Launch Webmail (1-Click SSO)
    </a>
  </div>
  <p class="text-sm text-secondary mb-4">Add the following DNS records to your domain registrar (Cloudflare, Namecheap, etc.) to ensure 100% email deliverability:</p>
  <div class="overflow-x-auto">
    <table class="table table-zebra w-full text-sm">
      <thead>
        <tr>
          <th>Type</th>
          <th>Host / Name</th>
          <th>Value / Target</th>
          <th>Priority</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><span class="badge badge-primary">MX</span></td>
          <td><code>@</code></td>
          <td><code>mail.hostaffin.com</code></td>
          <td>10</td>
          <td><button class="btn btn-ghost btn-xs" onclick="copyText('mail.hostaffin.com')">Copy</button></td>
        </tr>
        <tr>
          <td><span class="badge badge-accent">TXT</span></td>
          <td><code>@</code></td>
          <td><code>v=spf1 mx include:_spf.hostaffin.com ~all</code></td>
          <td>-</td>
          <td><button class="btn btn-ghost btn-xs" onclick="copyText('v=spf1 mx include:_spf.hostaffin.com ~all')">Copy</button></td>
        </tr>
        <tr>
          <td><span class="badge badge-info">TXT</span></td>
          <td><code>affinmail._domainkey</code></td>
          <td><code class="break-all">{$dkimPublicKey}</code></td>
          <td>-</td>
          <td><button class="btn btn-ghost btn-xs" onclick="copyText('{$dkimPublicKey}')">Copy</button></td>
        </tr>
        <tr>
          <td><span class="badge badge-warning">TXT</span></td>
          <td><code>_dmarc</code></td>
          <td><code>v=DMARC1; p=quarantine; rua=mailto:dmarc@{$domain}</code></td>
          <td>-</td>
          <td><button class="btn btn-ghost btn-xs" onclick="copyText('v=DMARC1; p=quarantine; rua=mailto:dmarc@{$domain}')">Copy</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```
