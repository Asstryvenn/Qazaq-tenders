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
}

export interface SupplierSearchResponse {
  offers: SupplierOffer[];
  live: true;
  fetchedAt: string;
}
