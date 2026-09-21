import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export async function shareFile(filename, blob, text = "") {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const { uri } = await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data });
  await Share.share({ title: "MannaGrams", text, files: [uri] });
}
