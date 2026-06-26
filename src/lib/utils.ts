/**
 * Generates a SHA-256-like hex token client-side using Web Crypto API.
 * Mirrors the server-side pgcrypto generate_scan_token function.
 */
export async function generateScanToken(userId: string, barcode: string): Promise<string> {
  const timestamp = Date.now().toString();
  const input = `${userId}${barcode}${timestamp}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface OFFProduct {
  product_name?: string;
  brands?: string;
  categories?: string;
  image_url?: string;
  image_front_url?: string;
  image_front_small_url?: string;
  images?: Record<string, { url?: string; sizes?: Record<string, { url?: string }> }>;
  nutriscore_grade?: string;
  packaging?: string;
  quantity?: string;
  countries?: string;
}

export async function fetchOpenFoodFacts(barcode: string): Promise<OFFProduct | null> {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== 1 || !json.product) return null;

    const product = json.product as OFFProduct;

    // Try to get the best available image
    let imageUrl = product.image_front_url || product.image_url;

    // If no direct image URL, try to extract from images object
    if (!imageUrl && product.images) {
      const imageKeys = Object.keys(product.images).filter(k => !k.startsWith('_') && k !== 'nutrition');
      if (imageKeys.length > 0) {
        const firstImage = product.images[imageKeys[0]];
        if (firstImage?.url) {
          imageUrl = firstImage.url;
        } else if (firstImage?.sizes?.full?.url) {
          imageUrl = firstImage.sizes.full.url;
        } else if (firstImage?.sizes?.small?.url) {
          imageUrl = firstImage.sizes.small.url;
        }
      }
    }

    // Construct image URL if we found images but no direct URL
    if (!imageUrl && product.images && Object.keys(product.images).length > 0) {
      const imageKeys = Object.keys(product.images).filter(k => !k.startsWith('_') && k !== 'nutrition');
      if (imageKeys.length > 0) {
        imageUrl = `https://images.openfoodfacts.org/images/products/${barcode}/${imageKeys[0]}.jpg`;
      }
    }

    return {
      ...product,
      image_url: imageUrl || null,
    };
  } catch {
    return null;
  }
}

export const ACQUISITION_SOURCES = [
  'Supermercado',
  'Tienda de barrio',
  'Droguería',
  'Restaurante',
  'Cafetería',
  'Máquina dispensadora',
  'Evento / concierto',
  'Otro',
];

export const KNOWN_BRANDS: Record<string, string> = {
  postobón: 'Postobón',
  postobon: 'Postobón',
  'coca-cola': 'Coca-Cola',
  cocacola: 'Coca-Cola',
  pepsi: 'Pepsi',
  manzana: 'Postobón',
  gaseosas: 'Postobón',
  bavaria: 'Bavaria',
  águila: 'Bavaria',
  cristal: 'Cristal',
  brisa: 'Brisa',
  manantial: 'Manantial',
  nestlé: 'Nestlé',
  sprite: 'Coca-Cola',
  fanta: 'Coca-Cola',
};

export function guessCompanyFromBrand(brand: string): string | null {
  const lower = brand.toLowerCase();
  for (const [key, val] of Object.entries(KNOWN_BRANDS)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

export function formatPoints(pts: number): string {
  return pts.toLocaleString('es-CO');
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days} día${days !== 1 ? 's' : ''}`;
}

export function getDisplayName(name: string | null | undefined, email: string | null | undefined): string {
  if (name && name.trim()) return name.trim();
  if (email && email.includes('@')) return email.split('@')[0];
  return 'Usuario';
}
