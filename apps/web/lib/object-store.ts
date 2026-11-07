import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { InputError } from "./input-repository";
export interface ObjectStore {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}
export function safeKey(key: string) {
  if (
    (!key.startsWith("shoots/") && !key.startsWith("knowledge/")) ||
    key.split("/").some((s) => !s || s === "." || s === "..") ||
    !/^[A-Za-z0-9/_.-]+$/.test(key)
  )
    throw new InputError("INVALID_KEY", "Invalid storage key.");
  return key;
}
export class LocalObjectStore implements ObjectStore {
  constructor(private root: string) {
    const resolved = path.resolve(root);
    for (const publicRoot of [
      path.resolve(process.cwd(), "public"),
      path.resolve(process.cwd(), "apps/web/public"),
    ]) {
      if (resolved === publicRoot || resolved.startsWith(publicRoot + path.sep))
        throw new Error("Private media cannot live under a public directory");
    }
    if (process.env.NODE_ENV === "production")
      throw new Error("Local media storage is forbidden in production");
  }
  private file(key: string) {
    return path.join(this.root, safeKey(key));
  }
  async put(key: string, bytes: Uint8Array) {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, bytes, { mode: 0o600, flag: "wx" });
  }
  async get(key: string) {
    return readFile(/* turbopackIgnore: true */ this.file(key));
  }
  async remove(key: string) {
    try {
      await unlink(this.file(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
}
export class S3ObjectStore implements ObjectStore {
  private client: S3Client;
  constructor(
    private bucket: string,
    endpoint: string,
    region: string,
  ) {
    if (!bucket || !endpoint.startsWith("https://") || !region)
      throw new Error(
        "Configure a private S3 bucket, HTTPS endpoint and region",
      );
    this.client = new S3Client({
      endpoint,
      region,
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 },
      forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
        secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
      },
    });
  }
  async put(key: string, bytes: Uint8Array, mime: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey(key),
        Body: bytes,
        ContentType: mime,
        IfNoneMatch: "*",
      }),
    );
  }
  async get(key: string) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
    );
    if (!response.Body) throw new Error("Object unavailable");
    return response.Body.transformToByteArray();
  }
  async remove(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
    );
  }
}
export function objectStore(): ObjectStore {
  const driver =
    process.env.STORAGE_DRIVER ??
    (process.env.DATA_MODE === "mock" ? "local" : "s3");
  if (driver === "local")
    return new LocalObjectStore(
      path.resolve(
        /* turbopackIgnore: true */ process.env.STORAGE_LOCAL_DIR ??
          ".data/private-objects",
      ),
    );
  if (driver !== "s3") throw new Error("Unknown storage driver");
  // SDK default chain is intentionally restricted to explicitly configured application keys.
  if (
    !process.env.STORAGE_ACCESS_KEY_ID ||
    !process.env.STORAGE_SECRET_ACCESS_KEY
  )
    throw new Error("Private storage credentials are not configured");
  return new S3ObjectStore(
    process.env.STORAGE_BUCKET ?? "",
    process.env.STORAGE_ENDPOINT ?? "",
    process.env.STORAGE_REGION ?? "",
  );
}
