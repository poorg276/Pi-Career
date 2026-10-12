export interface Fingerprint { bytes: number; sha256: string }
export interface ArchiveItem extends Fingerprint { source: string; destination: string; status: string }
export interface ArchiveOptions {
  root?: string;
  apply?: boolean;
  registerExisting?: boolean;
  acceptVersion?: string;
  afterMove?: (item: ArchiveItem) => void | Promise<void>;
}
export interface ArchiveResult {
  schema: number;
  apply: boolean;
  keptVersions: string[];
  pendingRecovery: string[];
  candidates: string[];
  movedFiles: number;
  bytes: number;
  items: ArchiveItem[];
  manifest?: string;
}
export function compareVersions(a: string, b: string): number;
export function safePath(root: string, rel: string): Promise<string>;
export function fingerprint(path: string): Promise<Fingerprint>;
export function archiveReleases(options?: ArchiveOptions): Promise<ArchiveResult>;
