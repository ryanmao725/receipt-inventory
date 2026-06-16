import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { CreateUploadUrlResponse } from "@receipt-scanner/shared";
import { log } from "./log.js";

const BUCKET = process.env.RECEIPTS_BUCKET ?? "";
const s3 = new S3Client({});

/** S3 object key for a user's receipt image. */
export function buildImageKey(userId: string, receiptId: string): string {
  return `receipts/${userId}/${receiptId}`;
}

/** True only for keys of the exact form receipts/{userId}/{receiptId}. */
export function isOwnedKey(userId: string, key: string): boolean {
  const parts = key.split("/");
  return (
    parts.length === 3 &&
    parts[0] === "receipts" &&
    parts[1] === userId &&
    parts[2].length > 0
  );
}

/** Last path segment (the receiptId). */
export function parseReceiptId(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1] ?? "";
}

/** Injectable presign so tests don't hit AWS. */
export type PresignFn = (command: PutObjectCommand) => Promise<string>;
const defaultPresign: PresignFn = (command) => getSignedUrl(s3, command, { expiresIn: 300 });

export async function createUploadUrl(
  userId: string,
  newId: () => string = () => crypto.randomUUID(),
  presign: PresignFn = defaultPresign,
): Promise<CreateUploadUrlResponse> {
  const receiptId = newId();
  const imageS3Key = buildImageKey(userId, receiptId);
  const uploadUrl = await presign(new PutObjectCommand({ Bucket: BUCKET, Key: imageS3Key }));
  log.debug({ imageS3Key }, "presigned upload url issued");
  return { uploadUrl, imageS3Key };
}
