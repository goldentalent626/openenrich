import { resolveMx } from "node:dns/promises";

export async function mxHosts(domain: string): Promise<string[]> {
  try {
    const records = await resolveMx(domain);
    return records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
  } catch {
    return [];
  }
}

const PROVIDERS: [RegExp, string][] = [
  [/google|googlemail|aspmx/i, "Google Workspace"],
  [/outlook|microsoft|office365|protection\.outlook/i, "Microsoft 365"],
  [/zoho/i, "Zoho"],
  [/proofpoint|pphosted/i, "Proofpoint"],
  [/mimecast/i, "Mimecast"],
  [/barracuda/i, "Barracuda"],
  [/secureserver|godaddy/i, "GoDaddy"],
  [/protonmail|proton\.me/i, "Proton"],
  [/fastmail|messagingengine/i, "Fastmail"],
  [/yandex/i, "Yandex"],
  [/mailgun|sendgrid|mandrill/i, "transactional relay"],
  [/hostinger|titan\.email/i, "Titan"],
  [/ionos|1and1/i, "IONOS"],
  [/ovh/i, "OVH"],
];

export function mailProvider(hosts: string[]): string | undefined {
  const joined = hosts.join(" ");
  for (const [re, name] of PROVIDERS) if (re.test(joined)) return name;
  return hosts[0]?.replace(/\.$/, "");
}
