import { Routes } from '@angular/router';

export const DOCUMENTS_ROUTES: Routes = [
  {
    path: 'upload',
    loadComponent: () => import('./pages/upload-page/upload-page').then((m) => m.UploadPage),
  },
  // Después de `upload`: el orden evita que `/documents/upload` se interprete como un `id`.
  {
    path: ':id',
    loadComponent: () => import('./pages/document-viewer-page/document-viewer-page').then((m) => m.DocumentViewerPage),
  },
];
