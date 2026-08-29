import { DomainMemory } from "./domains.js";
import { mailProvider, mxHosts } from "./mx.js";
import { scrapeDomain, type ScrapeOptions } from "../providers/scrape.js";
import type { PatternId } from "../providers/patterns.js";

export interface CompanyFacts {
  domain: string;
  title?: string;
  description?: string;
  socials: string[];
  roleEmails: string[];
  mx: string[];
  mailProvider?: string;
  pattern?: PatternId;
  patternSource?: string;
  catchAll?: boolean;
  hasWebsite: boolean;
}

function toDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0]
    .split(":")[0];
}

/** Free firmographics: everything the local engine already has to fetch anyway. */
export async function enrichCompany(
  input: string,
  domains: DomainMemory = new DomainMemory(),
  opts: ScrapeOptions = {},
): Promise<CompanyFacts> {
  const domain = toDomain(input);
  const [findings, mx] = await Promise.all([
    scrapeDomain(domain, domains, opts),
    mxHosts(domain),
  ]);
  const fact = domains.get(domain);

  return {
    domain,
    title: findings.title,
    description: findings.description,
    socials: findings.socials,
    roleEmails: findings.roleEmails,
    mx,
    mailProvider: mailProvider(mx),
    pattern: fact.pattern,
    patternSource: fact.patternSource,
    catchAll: fact.catchAll,
    hasWebsite: findings.pages.length > 0,
  };
}
