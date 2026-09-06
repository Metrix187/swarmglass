import { createInterface } from 'node:readline';
import { hashPassword } from '../src/console/auth.ts';

// prints an scrypt hash for SWARMGLASS_CONSOLE_PASSWORD_HASH. reads from a hidden prompt so the
// password never lands in shell history. pass --stdin to pipe it in instead.
async function main(): Promise<void> {
  let password = '';
  if (process.argv.includes('--stdin')) {
    password = (await new Promise<string>((resolve) => {
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => (buf += c));
      process.stdin.on('end', () => resolve(buf));
    })).trim();
  } else {
    password = await hiddenPrompt('console password: ');
    const again = await hiddenPrompt('again: ');
    if (password !== again) {
      console.error('passwords do not match');
      process.exit(1);
    }
  }
  if (password.length < 12) {
    console.error('use at least 12 characters');
    process.exit(1);
  }
  console.log(hashPassword(password));
}

function hiddenPrompt(q: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = process.stdout as NodeJS.WriteStream & { muted?: boolean };
    const origWrite = out.write.bind(out);
    let muted = false;
    (out as unknown as { write: (chunk: string | Uint8Array) => boolean }).write = (chunk: string | Uint8Array) => (muted ? true : origWrite(chunk));
    rl.question(q, (answer) => {
      muted = false;
      (out as unknown as { write: typeof origWrite }).write = origWrite;
      origWrite('\n');
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

await main();
