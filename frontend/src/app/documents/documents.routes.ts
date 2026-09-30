import { Routes } from '@angular/router';

export const DOCUMENTS_ROUTES: Routes = [
  {
    path: 'upload',
    loadComponent: () => import('./pages/upload-page/upload-page').then((m) => m.UploadPage),
  },
];
