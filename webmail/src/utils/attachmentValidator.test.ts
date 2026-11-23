import { describe, it, expect } from 'vitest';
import { validateAttachment, validateMultipleAttachments, formatFileSize } from './attachmentValidator';

describe('AffinMail Plan-Driven Attachment Guard', () => {
  it('correctly formats byte sizes', () => {
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(1024 * 50)).toBe('50.0 KB');
    expect(formatFileSize(1024 * 1024 * 15)).toBe('15.0 MB');
  });

  it('permits file within plan limit (e.g. 10MB file on 25MB plan)', () => {
    const file = { name: 'Q4_Financial_Report.pdf', size: 10 * 1024 * 1024 };
    const result = validateAttachment(file, 25);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.formattedSize).toBe('10.0 MB');
  });

  it('strictly rejects file exceeding plan limit (e.g. 26MB file on 25MB plan)', () => {
    const file = { name: 'Full_Raw_Footage.mp4', size: 26 * 1024 * 1024 };
    const result = validateAttachment(file, 25);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('exceeds your hosting plan\'s attachment limit of 25 MB');
  });

  it('enforces exact limit boundary', () => {
    const exactFile = { name: 'exact.zip', size: 25 * 1024 * 1024 };
    const result = validateAttachment(exactFile, 25);
    expect(result.valid).toBe(true);

    const oneByteOver = { name: 'over.zip', size: 25 * 1024 * 1024 + 1 };
    const overResult = validateAttachment(oneByteOver, 25);
    expect(overResult.valid).toBe(false);
  });

  it('validates multiple attachments sum against plan ceiling', () => {
    const files = [
      { name: 'doc1.pdf', size: 10 * 1024 * 1024 },
      { name: 'doc2.pdf', size: 12 * 1024 * 1024 },
    ];
    // 22MB total on 25MB plan -> valid
    expect(validateMultipleAttachments(files, 25).valid).toBe(true);

    // 22MB total on 15MB plan -> invalid
    const invalidResult = validateMultipleAttachments(files, 15);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.error).toContain('exceeds your plan limit of 15 MB');
  });
});
