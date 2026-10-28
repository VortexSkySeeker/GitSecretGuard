import fs from "node:fs";
import path from "node:path";

export interface SecretRule {
  id: string;
  label: string;
  pattern: RegExp;
}

export interface SecretFinding {
  file: string;
  line: number;
  ruleId: string;
  label: string;
  redactedSample: string;
  entropy: number;
}

const SECRET_RULES: SecretRule[] = [
  { id: "GH_PAT", label: "GitHub Personal Access Token", pattern: /gh[pousr]_[A-Za-z0-9_]{24,255}/ },
  { id: "AWS_KEY", label: "AWS Access Key ID", pattern: /AKIA[0-9A-Z]{16}/ },
  { id: "STRIPE_KEY", label: "Stripe Live Secret Key", pattern: /sk_live_[0-9a-zA-Z]{16,99}/ },
  { id: "SLACK_TOKEN", label: "Slack Bot/User Token", pattern: /xox[baprs]-[0-9a-zA-Z-]{10,72}/ },
  { id: "PRIVATE_KEY", label: "PEM Private Key Header", pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: "GENERIC_SECRET", label: "Hardcoded Secret Assignment", pattern: /(?:api_key|secret_key|access_token|private_token)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i }
];

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next"]);

export function computeShannonEntropy(input: string): number {
  if (!input || input.length === 0) return 0;
  const frequencies = new Map<string, number>();
  for (const char of input) {
    frequencies.set(char, (frequencies.get(char) || 0) + 1);
  }
  let entropy = 0;
  const len = input.length;
  for (const count of frequencies.values()) {
    const probability = count / len;
    entropy -= probability * Math.log2(probability);
  }
  return Number(entropy.toFixed(2));
}

export function redactSecret(raw: string): string {
  if (raw.length <= 8) return "********";
  return `${raw.slice(0, 4)}${"*".repeat(Math.min(12, raw.length - 8))}${raw.slice(-4)}`;
}

export function scanContentForSecrets(filePath: string, content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((lineText, idx) => {
    for (const rule of SECRET_RULES) {
      const match = lineText.match(rule.pattern);
      if (match && match[0]) {
        findings.push({
          file: filePath,
          line: idx + 1,
          ruleId: rule.id,
          label: rule.label,
          redactedSample: redactSecret(match[0]),
          entropy: computeShannonEntropy(match[0])
        });
      }
    }
  });
  return findings;
}

export function scanDirectory(rootDir: string): SecretFinding[] {
  const results: SecretFinding[] = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanDirectory(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx|json|yml|yaml|env|py|go|sh)$/.test(entry.name)) {
      const content = fs.readFileSync(fullPath, "utf8");
      results.push(...scanContentForSecrets(fullPath, content));
    }
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const targetDir = process.argv[2] || ".";
  const findings = scanDirectory(path.resolve(targetDir));
  console.log(JSON.stringify({ scannedRoot: targetDir, totalFindings: findings.length, findings }, null, 2));
  process.exit(findings.length > 0 ? 1 : 0);
}