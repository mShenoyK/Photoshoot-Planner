import sharp from "sharp";
import { InputError } from "./input-repository";
export function maxUploadBytes() {
  const mb = Number(process.env.MAX_IMAGE_UPLOAD_MB ?? 15);
  if (!Number.isFinite(mb) || mb < 1 || mb > 30)
    throw new Error("Upload limit must be 1–30 MB");
  return Math.floor(mb * 1024 * 1024);
}
export async function boundedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("EMPTY_UPLOAD", "Choose an image.");
  const deadline = Date.now() + 10000;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new InputError(
          "UPLOAD_TIMEOUT",
          "Upload took too long. Please retry.",
          408,
        );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new InputError(
                  "UPLOAD_TIMEOUT",
                  "Upload took too long. Please retry.",
                  408,
                ),
              ),
            remaining,
          );
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      const { done, value } = next;
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new InputError(
          "UPLOAD_TOO_LARGE",
          "Image exceeds the upload limit.",
          413,
        );
      }
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
function signature(bytes: Buffer) {
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
    return "image/jpeg";
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  return null;
}
export const imageIntake = {
  async inspect(bytes: Buffer, mime: string) {
    if (signature(bytes) !== mime)
      throw new InputError(
        "INVALID_IMAGE",
        "Image signature does not match its declared type.",
      );
    try {
      const decoder = sharp(bytes, {
        limitInputPixels: 40000000,
        failOn: "warning",
      });
      const meta = await decoder.metadata();
      if (!meta.width || !meta.height || meta.width < 256 || meta.height < 256)
        throw new InputError(
          "IMAGE_TOO_SMALL",
          "Use an image at least 256 × 256 pixels.",
        );
      if ((meta.pages ?? 1) > 1)
        throw new InputError(
          "ANIMATED_IMAGE",
          "Animated images are not supported.",
        );
      if (!["jpeg", "png", "webp"].includes(meta.format ?? ""))
        throw new InputError("INVALID_IMAGE", "Unsupported image format.");
      const derivative = await decoder
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      const warnings: string[] = [];
      if (Math.min(meta.width, meta.height) < 1000)
        warnings.push(
          "Low resolution: a larger image may show clothing and lighting more clearly.",
        );
      const stats = await sharp(derivative.data).stats();
      if (stats.channels.slice(0, 3).every((c) => c.stdev < 8))
        warnings.push(
          "Low contrast: check focus, lighting and detail before relying on this reference.",
        );
      return {
        bytes: derivative.data,
        width: derivative.info.width,
        height: derivative.info.height,
        warnings,
      };
    } catch (e) {
      if (e instanceof InputError) throw e;
      throw new InputError(
        "INVALID_IMAGE",
        "This image could not be decoded safely. Try an unedited JPG, PNG or WebP.",
      );
    }
  },
};
