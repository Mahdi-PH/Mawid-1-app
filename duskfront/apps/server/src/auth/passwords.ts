/** تجزئة كلمات المرور بـ argon2id / argon2id password hashing. */
import argon2 from 'argon2';

/** معاملات argon2id: موازنة بين الأمان وزمن الاستجابة على خادم لعبة. */
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB — توصية OWASP الدنيا
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** هل تحتاج التجزئة إعادة حساب بعد تغيّر المعاملات؟ */
export function needsRehash(hash: string): boolean {
  return !hash.startsWith('$argon2id$');
}
