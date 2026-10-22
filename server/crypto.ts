import crypto from 'crypto';
import { InsertUserCryptoIdentity, InsertSupervisorCryptoIdentity } from '@shared/schema';

// Configuration constants
const RSA_KEY_SIZE = 2048;
const SIGNATURE_ALGORITHM = 'RSA-SHA256';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

// Get server secret for key encryption (require proper configuration)
function getServerSecret(): string {
  const secret = process.env.CRYPTO_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('CRYPTO_SECRET or SESSION_SECRET environment variable is required for cryptographic operations');
  }
  return secret;
}

// Generate RSA key pair for digital signatures
export function generateRSAKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: RSA_KEY_SIZE,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  return { publicKey, privateKey };
}

// Encrypt private key with server secret
export function encryptPrivateKey(privateKey: string): string {
  const secret = getServerSecret();
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12); // 12 bytes for GCM
  const key = Buffer.from(crypto.hkdfSync('sha256', secret, salt, 'ojt-keywrap', 32));
  
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Combine salt, IV, auth tag, and encrypted data
  return salt.toString('hex') + ':' + iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

// Decrypt private key with server secret
export function decryptPrivateKey(encryptedPrivateKey: string): string {
  const secret = getServerSecret();
  
  const parts = encryptedPrivateKey.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted private key format');
  }
  
  const salt = Buffer.from(parts[0], 'hex');
  const iv = Buffer.from(parts[1], 'hex');
  const authTag = Buffer.from(parts[2], 'hex');
  const encrypted = parts[3];
  
  const key = Buffer.from(crypto.hkdfSync('sha256', secret, salt, 'ojt-keywrap', 32));
  
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// Create digital signature for data
export function createDigitalSignature(data: string, privateKey: string): string {
  const sign = crypto.createSign(SIGNATURE_ALGORITHM);
  sign.update(data, 'utf8');
  return sign.sign(privateKey, 'base64');
}

// Verify digital signature
export function verifyDigitalSignature(data: string, signature: string, publicKey: string): boolean {
  try {
    const verify = crypto.createVerify(SIGNATURE_ALGORITHM);
    verify.update(data, 'utf8');
    return verify.verify(publicKey, signature, 'base64');
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

// Properly escape string for JSON-style canonicalization
function escapeString(str: string): string {
  return str.replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t')
            .replace(/[\b]/g, '\\b')
            .replace(/\f/g, '\\f')
            .replace(/[\u0000-\u001f]/g, (match) => '\\u' + match.charCodeAt(0).toString(16).padStart(4, '0'));
}

// Canonicalize data for stable hashing (ensures consistent field order and Date serialization)
function canonicalizeData(data: any): string {
  if (data === null) {
    return 'null';
  } else if (data === undefined) {
    return 'null'; // Treat undefined as null for consistency
  } else if (typeof data === 'number') {
    if (Number.isNaN(data)) {
      return '"NaN"';
    } else if (!Number.isFinite(data)) {
      return data > 0 ? '"Infinity"' : '"-Infinity"';
    } else {
      return String(data);
    }
  } else if (typeof data === 'boolean') {
    return String(data);
  } else if (data instanceof Date) {
    return `"${data.toISOString()}"`;
  } else if (Array.isArray(data)) {
    return '[' + data.map(canonicalizeData).join(',') + ']';
  } else if (data && typeof data === 'object') {
    // Sort keys for consistent field order, omit undefined values
    const sortedKeys = Object.keys(data).sort().filter(key => data[key] !== undefined);
    const pairs = sortedKeys.map(key => `"${escapeString(key)}":${canonicalizeData(data[key])}`);
    return '{' + pairs.join(',') + '}';
  } else if (typeof data === 'string') {
    return `"${escapeString(data)}"`;
  } else {
    return 'null'; // Fallback for unknown types
  }
}

// Generate hash for data integrity with stable canonicalization
export function generateDataHash(data: any): string {
  const canonicalString = canonicalizeData(data);
  const hash = crypto.createHash('sha256');
  hash.update(canonicalString, 'utf8');
  return hash.digest('hex');
}

// Generate server integrity signature (prevents hash tampering)
export function generateIntegritySignature(dataHash: string): string {
  const secret = getServerSecret();
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(dataHash);
  return hmac.digest('hex');
}

// Verify server integrity signature
export function verifyIntegritySignature(dataHash: string, integritySignature: string): boolean {
  try {
    const expected = generateIntegritySignature(dataHash);
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(integritySignature, 'hex'));
  } catch (error) {
    console.error('Integrity signature verification error:', error);
    return false;
  }
}

// Create complete crypto identity for technician
export function createTechnicianCryptoIdentity(
  userId: number,
  personalInfo: {
    fullName: string;
    dateOfBirth: string;
    phoneNumber: string;
  },
  employeeIds: string[]
): InsertUserCryptoIdentity & { userId: number } {
  const { publicKey, privateKey } = generateRSAKeyPair();
  const encryptedPrivateKey = encryptPrivateKey(privateKey);
  
  return {
    userId,
    publicKey,
    encryptedPrivateKey,
    personalInfo,
    employeeIds,
  };
}

// Create complete crypto identity for supervisor
export function createSupervisorCryptoIdentity(
  email: string,
  professionalInfo: {
    fullName: string;
    dateOfBirth: string;
    phoneNumber: string;
    certifications: string;
    company: string;
  }
): InsertSupervisorCryptoIdentity {
  const { publicKey, privateKey } = generateRSAKeyPair();
  const encryptedPrivateKey = encryptPrivateKey(privateKey);
  
  return {
    email,
    publicKey,
    encryptedPrivateKey,
    professionalInfo,
  };
}

// Sign entry data with technician's private key
export function signEntryData(
  entryData: {
    date: Date;
    location: string;
    method: string;
    hours: number;
    employeeId: string;
  },
  encryptedPrivateKey: string
): {
  dataHash: string;
  technicianSignature: string;
  integritySignature: string;
} {
  try {
    const privateKey = decryptPrivateKey(encryptedPrivateKey);
    const dataHash = generateDataHash(entryData);
    const technicianSignature = createDigitalSignature(dataHash, privateKey);
    const integritySignature = generateIntegritySignature(dataHash);
    
    return {
      dataHash,
      technicianSignature,
      integritySignature,
    };
  } catch (error) {
    console.error('Error signing entry data:', error);
    throw new Error('Failed to create digital signature for entry');
  }
}

// Sign verification with supervisor's private key
export function signVerificationData(
  verificationData: {
    entryId: number;
    dataHash: string;
    supervisorEmail: string;
    verifiedAt: Date;
    ipAddress: string;
    browserInfo: string;
  },
  encryptedPrivateKey: string
): string {
  try {
    const privateKey = decryptPrivateKey(encryptedPrivateKey);
    const verificationHash = generateDataHash(verificationData);
    return createDigitalSignature(verificationHash, privateKey);
  } catch (error) {
    console.error('Error signing verification data:', error);
    throw new Error('Failed to create digital signature for verification');
  }
}

// Verify entry signature and integrity
export function verifyEntrySignature(
  entryData: any,
  technicianSignature: string,
  dataHash: string,
  integritySignature: string,
  publicKey: string
): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  let isValid = true;

  // Verify data hasn't been tampered with
  const currentDataHash = generateDataHash(entryData);
  if (currentDataHash !== dataHash) {
    errors.push('Entry data has been modified after signing');
    isValid = false;
  }

  // Verify integrity signature (prevents hash tampering)
  if (!verifyIntegritySignature(dataHash, integritySignature)) {
    errors.push('Data hash integrity signature is invalid');
    isValid = false;
  }

  // Verify technician's digital signature
  if (!verifyDigitalSignature(dataHash, technicianSignature, publicKey)) {
    errors.push('Technician digital signature is invalid');
    isValid = false;
  }

  return { isValid, errors };
}

// Generate email verification token
export function generateEmailVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Create audit trail entry
export function createAuditTrailEntry(
  action: string,
  userId?: number,
  supervisorEmail?: string,
  ipAddress?: string,
  browserInfo?: string,
  additionalData?: any
) {
  return {
    action,
    timestamp: new Date().toISOString(),
    userId,
    supervisorEmail,
    ipAddress,
    browserInfo,
    additionalData,
  };
}

// Validate crypto identity data
export function validateCryptoIdentity(publicKey: string, encryptedPrivateKey: string): boolean {
  try {
    // Test decryption of private key
    const privateKey = decryptPrivateKey(encryptedPrivateKey);
    
    // Test signing and verification
    const testData = 'test-signature-verification';
    const signature = createDigitalSignature(testData, privateKey);
    return verifyDigitalSignature(testData, signature, publicKey);
  } catch (error) {
    console.error('Crypto identity validation error:', error);
    return false;
  }
}

// Export types for use in other modules
export interface CryptoIdentityCreationResult {
  publicKey: string;
  encryptedPrivateKey: string;
  emailVerificationToken: string;
}

export interface SignatureVerificationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}