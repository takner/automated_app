// Operator CLI (run inside the app container):
//   node dist/cli.mjs create-owner --email you@example.com [--name "…"]
//   node dist/cli.mjs set-password --email you@example.com      (reads the new password from stdin)
//   node dist/cli.mjs vapid                                     (prints a new VAPID key pair)
//   node dist/cli.mjs export --email you@example.com > export.json
import webpush from 'web-push';
import { prisma } from '@/lib/db';
import { hashPassword, randomToken } from '@/lib/crypto';
import { exportUserData } from '@/lib/services/export';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'create-owner': {
      const email = arg('email')?.toLowerCase();
      if (!email) throw new Error('--email is required');
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        console.error('user already exists; use set-password to change the password');
        process.exit(2);
      }
      const password = randomToken(18);
      await prisma.user.create({
        data: { email, name: arg('name') ?? null, passwordHash: await hashPassword(password), settings: { create: {} } },
      });
      // printed once, to stdout only, so the operator can redirect it to a protected file
      console.log(password);
      break;
    }
    case 'set-password': {
      const email = arg('email')?.toLowerCase();
      if (!email) throw new Error('--email is required');
      const pw = await readStdin();
      if (pw.length < 12) throw new Error('password must be at least 12 characters');
      await prisma.user.update({ where: { email }, data: { passwordHash: await hashPassword(pw) } });
      await prisma.session.deleteMany({ where: { user: { email } } });
      console.error('password updated; all sessions signed out');
      break;
    }
    case 'vapid': {
      const k = webpush.generateVAPIDKeys();
      console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}`);
      break;
    }
    case 'export': {
      const email = arg('email')?.toLowerCase();
      if (!email) throw new Error('--email is required');
      const u = await prisma.user.findUniqueOrThrow({ where: { email } });
      console.log(JSON.stringify(await exportUserData(u.id), null, 2));
      break;
    }
    default:
      console.error('commands: create-owner | set-password | vapid | export');
      process.exit(1);
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
