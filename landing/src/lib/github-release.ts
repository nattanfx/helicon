import { cache } from "react";
import { RELEASES_URL, REPO_URL } from "./site";

export type InstallerKind = "windows" | "macos";

export type ReleaseAsset = {
  version: string;
  name: string;
  url: string;
  size: number;
};

export type LatestRelease = {
  version: string;
  tag: string;
  notesUrl: string;
  assets: Array<{ name: string; size: number; browser_download_url: string }>;
};

type GithubRelease = {
  tag_name?: string;
  html_url?: string;
  assets?: LatestRelease["assets"];
};

const repoPath = REPO_URL.replace("https://github.com/", "");

function matchAsset(kind: InstallerKind, name: string) {
  if (kind === "windows") return /setup\.exe$/i.test(name) && !/\.sig$/i.test(name);
  return /\.dmg$/i.test(name) && !/\.sig$/i.test(name);
}

async function githubHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "helicon.sh",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** One GitHub fetch per request. Cached for a minute so a new tag shows up without a redeploy. */
export const latestRelease = cache(async (): Promise<LatestRelease | null> => {
  try {
    const res = await fetch(`https://api.github.com/repos/${repoPath}/releases/latest`, {
      headers: await githubHeaders(),
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as GithubRelease;
    const tag = body.tag_name ?? "";
    const version = tag.replace(/^v/, "");
    if (!version) return null;
    return {
      version,
      tag,
      notesUrl: body.html_url || RELEASES_URL,
      assets: body.assets ?? [],
    };
  } catch {
    return null;
  }
});

export async function latestInstaller(kind: InstallerKind): Promise<ReleaseAsset | null> {
  const release = await latestRelease();
  if (!release) return null;
  const asset = release.assets.find((item) => matchAsset(kind, item.name));
  if (!asset) return null;
  return {
    version: release.version,
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
  };
}
