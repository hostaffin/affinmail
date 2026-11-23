# AffinMail: Testing & Quality Assurance Strategy

---

## 1. Testing Pyramid & QA Philosophy

AffinMail's QA philosophy prioritizes deterministic validation of protocol compliance, deliverability scoring, data safety, and responsive UI performance:
1. **Unit & Component Testing:** Fast, isolated testing for React components, TipTap editor extensions, keyboard hooks, and attachment size validators.
2. **Integration Testing:** Validation of PostgreSQL transactions, Redis Leaky-Bucket counters, JMAP batched method execution, and Hostaffin driver lifecycle routines.
3. **End-to-End (E2E) Testing:** Playwright suites simulating full user journeys from Hostaffin 1-click SSO into Webmail inbox reading, composing with attachments, and dark mode toggling.
4. **Deliverability & Compliance Testing:** Automated checking of SPF, DKIM, DMARC, PTR, and Spamhaus scores.
5. **Load & Concurrency Testing:** k6 and Locust scenarios testing 5,000 concurrent WebSocket and JMAP sessions.

---

## 2. Test Suites & Tooling Matrix

| Layer | Target | Tool / Framework | Target Coverage |
| :--- | :--- | :--- | :--- |
| **Frontend Webmail** | Components, Hooks, State | Vitest + React Testing Library | > 85% |
| **Frontend E2E** | Full User Journey & Hotkeys | Playwright (Chromium, WebKit, Firefox) | Core workflows |
| **Billing Driver** | 20 WHMCS Lifecycle Methods | PHPUnit 10 | 100% method coverage |
| **Database & Cache** | DDL, Triggers, Redis Limiter | pgTAP + Jest integration tests | Zero regressions |
| **Deliverability** | DKIM/SPF/DMARC syntax | Python `checkdmarc` + `authres` | 10/10 Score |
| **Load Testing** | Inbound JMAP & SMTP | k6 / Locust | 5,000 Virtual Users |

---

## 3. Webmail Frontend Unit Tests (Vitest)

### Attachment Guard Test Spec
```typescript
import { describe, it, expect } from 'vitest';
import { validateAttachment } from '../src/utils/attachmentValidator';

describe('Plan-Driven Attachment Guard', () => {
  it('allows file under plan maximum size', () => {
    const file = new File(['a'.repeat(10 * 1024 * 1024)], 'invoice.pdf', { type: 'application/pdf' });
    const result = validateAttachment(file, 25); // 25MB limit
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects file strictly exceeding plan maximum size', () => {
    const file = new File(['a'.repeat(26 * 1024 * 1024)], 'large_video.mp4', { type: 'video/mp4' });
    const result = validateAttachment(file, 25);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('exceeds your plan limit of 25 MB');
  });
});
```

---

## 4. Hostaffin PHP Driver Tests (PHPUnit)

```php
<?php
use PHPUnit\Framework\TestCase;

class AffinMailDriverTest extends TestCase {
    private $params;

    protected function setUp(): void {
        $this->params = [
            'domain' => 'clienttest.com',
            'username' => 'admin',
            'password' => 'SecurePass987!',
            'configoption1' => '10240', // 10GB
            'configoption2' => '5',     // 5 mailboxes
            'configoption3' => '25',    // 25MB attachment
            'configoption4' => '200',   // 200/hr
            'configoption5' => 'direct'
        ];
    }

    public function testCreateAccountReturnsSuccess() {
        $result = affinmail_CreateAccount($this->params);
        $this->assertEquals('success', $result);
    }

    public function testSuspendAccountTogglesStatus() {
        $result = affinmail_SuspendAccount($this->params);
        $this->assertEquals('success', $result);
    }
}
```

---

## 5. End-to-End (E2E) Test Plan (Playwright)

1. **Authentication & SSO Flow:**
   * Navigate to SSO redemption URL `/sso?token=...`.
   * Verify redirect to `/inbox` without login credentials prompt.
2. **Keyboard Navigation Workflow:**
   * Press `j` to focus the second thread in list.
   * Press `Enter` to expand thread.
   * Press `r` to open quick reply.
   * Press `Escape` to close.
3. **Docked Compose & Send:**
   * Press `c` to open compose modal.
   * Enter recipient and subject.
   * Drag test file (`20MB`) into dropzone -> Verify green checkmark.
   * Drag oversized test file (`30MB`) -> Verify immediate toast alert: "Attachment exceeds your plan's limit of 25 MB".
   * Click Send -> Verify optimistic thread creation in Sent folder.
4. **Theme Switcher:**
   * Toggle theme button from Light to Dark.
   * Verify `data-theme="dark"` attribute is placed on `<html>` element and contrast ratios meet WCAG AA standards.
