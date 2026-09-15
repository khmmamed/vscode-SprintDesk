// v1.0 Slice B — stat() supplies mtime/size for input discovery (name + mtime + content-hash dedup)
export interface FileStat {
  mtimeMs: number;
  size: number;
}

export interface IFileSystem {
  readFile(filePath: string): string;
  writeFile(filePath: string, content: string): void;
  exists(filePath: string): boolean;
  mkdir(dirPath: string, options?: { recursive?: boolean }): void;
  delete(filePath: string): void;
  list(dirPath: string): string[];
  stat(filePath: string): FileStat;
}