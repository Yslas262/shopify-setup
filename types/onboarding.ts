export interface StoreConfig {
  shop: string;
  accessToken: string;
}

export interface ThemeConfig {
  shop: string;
  accessToken: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string;
  faviconUrl?: string;
  bannerDesktopUrl?: string;
  bannerMobileUrl?: string;
  collections: CollectionInput[];
  themeId?: string;
}

export interface CollectionInput {
  name: string;
  handle: string;
  imageFile?: File;
  id?: string;
  imageUrl?: string;
}

export interface OnboardingState {
  currentStep: number;
  completedSteps: number[];
  errors: Record<number, string>;
  productIds: string[];
  collections: CollectionInput[];
  themeId: string;
}

export interface StepResult {
  success: boolean;
  errors?: string[];
}

export interface CsvValidationResult extends StepResult {
  totalProducts: number;
  preview: CsvProduct[];
}

export interface CsvProduct {
  handle: string;
  title: string;
  bodyHtml: string;
  vendor: string;
  type: string;
  tags: string;
  published: string;
  variantPrice: string;
  imageSrc: string;
  imagePosition: string;
}

export interface ProductImportResult extends StepResult {
  totalImported: number;
  productIds: string[];
}

export interface CollectionCreateResult extends StepResult {
  collections: { id: string; handle: string; name: string }[];
  bestSellersId: string;
}

export interface ThemeUploadResult extends StepResult {
  themeId: string;
}

export interface ImageUploadResult extends StepResult {
  logoUrl: string;
  faviconUrl: string;
  bannerDesktopUrl: string;
  bannerMobileUrl: string;
  collectionImages: { handle: string; url: string }[];
}

export interface ThemePublishResult extends StepResult {
  themeRole: string;
}
