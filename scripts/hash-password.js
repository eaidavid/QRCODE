import { hashPassword } from '../lib/password.js';

const password = process.argv[2];

if (!password || password.length < 6) {
  console.error('Use: node scripts/hash-password.js "sua-senha"');
  process.exit(1);
}

const hash = await hashPassword(password);
console.log(hash);
