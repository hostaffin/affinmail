/**
 * AffinMail Plan-Driven Attachment Guard
 * Strictly inspects byte size on client-side before upload to prevent server 552 errors and save client bandwidth.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
  formattedSize?: string;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateAttachment(file: { name: string; size: number }, planLimitMb: number): ValidationResult {
  const maxBytes = planLimitMb * 1024 * 1024;
  const formattedSize = formatFileSize(file.size);

  if (file.size > maxBytes) {
    return {
      valid: false,
      formattedSize,
      error: `File "${file.name}" (${formattedSize}) exceeds your hosting plan's attachment limit of ${planLimitMb} MB. Please compress or link via cloud storage.`
    };
  }

  return {
    valid: true,
    formattedSize
  };
}

export function validateMultipleAttachments(files: { name: string; size: number }[], planLimitMb: number): ValidationResult {
  for (const file of files) {
    const single = validateAttachment(file, planLimitMb);
    if (!single.valid) {
      return single;
    }
  }

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
  const maxBytes = planLimitMb * 1024 * 1024;
  if (totalBytes > maxBytes) {
    return {
      valid: false,
      formattedSize: formatFileSize(totalBytes),
      error: `Total attachments size (${formatFileSize(totalBytes)}) exceeds your plan limit of ${planLimitMb} MB.`
    };
  }

  return {
    valid: true,
    formattedSize: formatFileSize(totalBytes)
  };
}
