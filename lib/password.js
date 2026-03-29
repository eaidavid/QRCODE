import crypto from 'node:crypto';

export async function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') {
    return false;
  }

  const [scheme, salt, key] = storedHash.split('$');

  if (scheme !== 'scrypt' || !salt || !key) {
    return false;
  }

  const derivedKey = await scryptAsync(password, salt, 64);
  const expectedBuffer = Buffer.from(key, 'hex');

  if (derivedKey.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedKey, expectedBuffer);
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(8).toString('hex');
  const derivedKey = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

function scryptAsync(password, salt, keyLength) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}
