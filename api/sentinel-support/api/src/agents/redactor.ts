// PII Redaction Agent - Ensures no sensitive data appears in logs, traces, or UI
export class RedactorAgent {
  // PAN-like patterns (13-19 digits)
  private static readonly PAN_PATTERN = /\b\d{13,19}\b/g;
  
  // Email patterns
  private static readonly EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  
  // Phone patterns (basic)
  private static readonly PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g;
  
  // SSN patterns
  private static readonly SSN_PATTERN = /\b\d{3}-?\d{2}-?\d{4}\b/g;

  public static redactText(text: string): { redacted: string; masked: boolean } {
    if (!text) return { redacted: text, masked: false };

    let redacted = text;
    let masked = false;

    // Redact PAN-like sequences
    if (this.PAN_PATTERN.test(redacted)) {
      redacted = redacted.replace(this.PAN_PATTERN, '****REDACTED****');
      masked = true;
    }

    // Redact emails - keep domain for context
    if (this.EMAIL_PATTERN.test(redacted)) {
      redacted = redacted.replace(this.EMAIL_PATTERN, (match) => {
        const [username, domain] = match.split('@');
        return `${username.charAt(0)}***@${domain}`;
      });
      masked = true;
    }

    // Redact phone numbers
    if (this.PHONE_PATTERN.test(redacted)) {
      redacted = redacted.replace(this.PHONE_PATTERN, '***-***-****');
      masked = true;
    }

    // Redact SSNs
    if (this.SSN_PATTERN.test(redacted)) {
      redacted = redacted.replace(this.SSN_PATTERN, '***-**-****');
      masked = true;
    }

    return { redacted, masked };
  }

  public static redactObject(obj: any): { redacted: any; masked: boolean } {
    if (!obj) return { redacted: obj, masked: false };

    let masked = false;
    const redacted = this.deepRedact(obj, (value) => {
      if (typeof value === 'string') {
        const result = this.redactText(value);
        if (result.masked) masked = true;
        return result.redacted;
      }
      return value;
    });

    return { redacted, masked };
  }

  private static deepRedact(obj: any, redactFn: (value: any) => any): any {
    if (obj === null || typeof obj !== 'object') {
      return redactFn(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deepRedact(item, redactFn));
    }

    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.deepRedact(value, redactFn);
    }

    return result;
  }

  // Specific methods for common use cases
  public static redactForLogging(data: any): { data: any; masked: boolean } {
    const result = this.redactObject(data);
    return { data: result.redacted, masked: result.masked };
  }

  public static redactForUI(data: any): { data: any; masked: boolean } {
    const result = this.redactObject(data);
    return { data: result.redacted, masked: result.masked };
  }

  public static redactForTrace(data: any): { data: any; masked: boolean } {
    const result = this.redactObject(data);
    return { data: result.redacted, masked: result.masked };
  }

  // Card number redaction with partial reveal
  public static redactCardNumber(cardNumber: string, revealLast: number = 4): string {
    if (!cardNumber || cardNumber.length < 8) return '****REDACTED****';
    
    const cleaned = cardNumber.replace(/\D/g, '');
    if (cleaned.length < 13 || cleaned.length > 19) return '****REDACTED****';
    
    const masked = '*'.repeat(cleaned.length - revealLast);
    const revealed = cleaned.slice(-revealLast);
    
    return `${masked}${revealed}`;
  }

  // Test if string contains PII
  public static containsPII(text: string): boolean {
    if (!text) return false;
    
    return this.PAN_PATTERN.test(text) ||
           this.EMAIL_PATTERN.test(text) ||
           this.PHONE_PATTERN.test(text) ||
           this.SSN_PATTERN.test(text);
  }
}