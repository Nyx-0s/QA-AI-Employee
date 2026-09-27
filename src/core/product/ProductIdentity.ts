import { createHash } from "crypto";

export interface ProductIdentityResult {
  id: string;
  name: string;
  origin: string;
  hostname: string;
}

export class ProductIdentity {
  static fromUrl(input: string): ProductIdentityResult {
    const url = new URL(input);

    const hostname = url.hostname.toLowerCase();

    const readable =
      hostname
        .replace(/^www\./, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "product";

    const hash = createHash("sha256")
      .update(url.origin)
      .digest("hex")
      .slice(0, 8);

    return {
      id: `${readable}-${hash}`,
      name: hostname.replace(/^www\./, ""),
      origin: url.origin,
      hostname
    };
  }
}
