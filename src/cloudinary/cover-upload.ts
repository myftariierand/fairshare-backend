// Uploads are held in memory until processed, so these also protect the server. Only the size is
// checked here: the type a client declares can't be trusted, so CloudinaryService looks at the
// file's real contents instead.
export const coverUploadOptions = {
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 1,
    fields: 100, // Each invited user is a field when creating a group
    fieldSize: 64 * 1024,
  },
};
