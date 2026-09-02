"use client";

import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { firebaseApp } from "./config";

export const storage = getStorage(firebaseApp);

/** Uploads a clinic/beauty-center's business license image and returns its
 *  download URL. Path is `licenses/{uid}/...` — storage.rules restricts
 *  writes to that exact uid, so this must be called after the uploading
 *  user's own Auth account already exists (see registerClinic() in
 *  firestore.ts, which calls this right after createUserWithEmailAndPassword). */
export async function uploadLicenseImage(uid: string, file: File): Promise<string> {
  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const path = `licenses/${uid}/${Date.now()}_${safeName}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return getDownloadURL(fileRef);
}
