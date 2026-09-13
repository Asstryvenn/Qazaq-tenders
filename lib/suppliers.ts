export interface SupplierOffer {
  id: string;
  supplierName: string;
  productName: string;
  totalPriceKzt: number;
  unitPriceKzt?: number | null;
  quantity?: number | null;
  phone?: string;
  url: string;
  city?: string;
  availability?: string;
  updatedAt: string;
  source: string;
  cargoTonnes?: number | null;
  hasStKzCertificate?: boolean;
  status: "verified" | "smart_ai";
  isDemo: boolean;
  email?: string;
}

export interface SupplierSearchResponse {
  offers: SupplierOffer[];
  live: boolean;
  mode: "live" | "demo";
  fallbackReason?: string;
  fetchedAt: string;
}
