# Production Deployment Guide

## Overview
This application is a monorepo with:
- **Frontend**: React + Vite deployed on Vercel
- **Backend**: Node.js Cloud Functions + Firestore + Storage on Firebase

---

## Frontend Deployment (COMPLETE ✓)

### Vercel Configuration
- **Status**: Deployed
- **Root Directory**: `frontend/`
- **Framework**: Vite
- **Build Command**: `npm run build`
- **Output Directory**: `dist/`
- **SPA Routing**: Enabled in `vercel.json`

### Frontend Fix Applied
SPA routing rewrites added to `frontend/vercel.json`:
```json
"rewrites": [
  {
    "source": "/(.*)",
    "destination": "/index.html"
  }
]
```
This fixes 404 errors for non-root React Router paths.

---

## Backend Deployment (READY FOR DEPLOYMENT)

### Prerequisites
```bash
# 1. Install Firebase CLI
npm install -g firebase-tools

# 2. Authenticate with Firebase
firebase login

# 3. Navigate to frontend directory
cd frontend
```

### Deployment Steps

#### Step 1: Verify Configuration
```bash
firebase projects:list
firebase use warranty-intelligence-system
firebase target:list
```

#### Step 2: Deploy Firestore Database & Rules
```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

**Firestore Configuration**:
- Rules file: `frontend/firestore.rules`
- Indexes file: `frontend/firestore.indexes.json`
- Security: Authenticated users only with strict ownership validation
- Collections:
  - `users/{userId}` - Per-user settings
  - `products/{productId}` - User products with repairs subcollection
  - `products/{productId}/repairs/{repairId}` - Repair history
  - `notifications/{notifId}` - User notifications

#### Step 3: Deploy Storage Rules
```bash
firebase deploy --only storage
```

**Storage Configuration** (`frontend/storage.rules`):
- Path: `users/{userId}/invoices/` - 3MB files (PDF, JPG, PNG, WEBP)
- Path: `users/{userId}/avatar/` - 1MB images only
- Security: Authenticated users, per-user isolation, MIME type validation

#### Step 4: Install Cloud Functions Dependencies
```bash
cd frontend/functions
npm install
cd ..
```

**Dependencies** (`frontend/functions/package.json`):
- firebase-admin@12.7.0
- firebase-functions@4.9.0
- busboy@1.6.0

#### Step 5: Deploy Cloud Functions
```bash
firebase deploy --only functions
```

**Cloud Functions** (`frontend/functions/index.js`):
- `uploadInvoice()` - Server-side validated file upload
  - Validates: Auth, rate limiting, file size (3MB), MIME type, magic bytes
  - Returns: Signed URL for secure file access
  - Rate limit: 20 uploads per minute
- `healthCheck()` - API health verification

#### Step 6: Deploy Everything at Once
```bash
firebase deploy
```

This deploys:
- Firestore rules & indexes
- Storage rules
- Cloud Functions

### Deployment Status Checks
```bash
# View deployed functions
firebase functions:list

# View function logs
firebase functions:log

# Test functions locally
firebase emulators:start
```

---

## Environment Variables

### Frontend (.env)
```dotenv
# Firebase configuration (from Firebase Console > Project Settings)
VITE_FIREBASE_API_KEY=AIzaSyCi_GBlUB9I7pVZunUTW-OEx805-aOLLdM
VITE_FIREBASE_AUTH_DOMAIN=warranty-intelligence-system.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=warranty-intelligence-system
VITE_FIREBASE_STORAGE_BUCKET=warranty-intelligence-system.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=793748652065
VITE_FIREBASE_APP_ID=1:793748652065:web:e4238c01acfe24f934a360
VITE_FIREBASE_MEASUREMENT_ID=G-6H36MVV3RL

# Cloud Functions endpoint (set after deployment)
VITE_API_BASE_URL=https://region-warranty-intelligence-system.cloudfunctions.net
```

### Vercel Environment Variables
1. Log in to Vercel
2. Go to Project Settings > Environment Variables
3. Add all `VITE_*` variables from `.env`
4. Redeploy after adding variables

---

## Architecture

### Frontend (Vercel)
- React SPA with routing
- Firebase Authentication (client-side)
- Firestore direct access (client-side)
- Storage file uploads via Cloud Functions
- Built assets in `/dist`

### Backend (Firebase)
- **Firestore**: NoSQL database with user-isolated data
- **Storage**: File storage with 3MB limit, MIME type validation
- **Cloud Functions**: Serverless APIs for file upload validation
- **Authentication**: Firebase Auth (email/password, Google Sign-In)

### Security Layers
1. **Frontend**: Vite build minification, SPA routing
2. **Cloud Functions**: Request validation, rate limiting, CORS
3. **Storage**: MIME type checks, size limits, signed URLs
4. **Firestore**: Authentication required, IDOR prevention, RBAC rules

---

## Post-Deployment Checklist

- [ ] Frontend deployed on Vercel
  - [ ] Production URL loads landing page
  - [ ] React Router paths work (no 404)
  - [ ] Firebase config loads correctly
- [ ] Firestore deployed
  - [ ] Rules applied successfully
  - [ ] Collections created via Firebase Console
- [ ] Storage deployed
  - [ ] Rules applied successfully
  - [ ] Test file upload works
- [ ] Cloud Functions deployed
  - [ ] `healthCheck` endpoint responds
  - [ ] `uploadInvoice` endpoint accepts valid files
  - [ ] Rate limiting works
- [ ] Environment Variables
  - [ ] All `VITE_*` vars set in Vercel
  - [ ] Vercel redeployed after env var changes
- [ ] Frontend-Backend Connection
  - [ ] Auth flows work
  - [ ] File uploads succeed
  - [ ] Firestore reads work
  - [ ] Storage signed URLs work

---

## Troubleshooting

### Vercel 404 Errors
**Solution**: Verify `vercel.json` has SPA rewrites
```json
"rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
```
Status: ✓ Already applied

### Firebase Deployment Fails
1. Check authentication: `firebase login`
2. Verify project: `firebase use warranty-intelligence-system`
3. Check Node.js version (14+): `node --version`

### Cloud Functions Not Accessible
1. Check function logs: `firebase functions:log`
2. Verify region: `firebase deploy --debug`
3. Test locally: `firebase emulators:start`

### Storage Upload Fails
1. Check rules in Firebase Console
2. Verify MIME type is allowed (PDF, JPG, PNG, WEBP)
3. Verify file size ≤ 3MB
4. Check signed URL expiration

---

## CI/CD Integration (GitHub Actions)

To automate deployment, add to `.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      # Deploy Frontend
      - name: Deploy Frontend to Vercel
        run: |
          npm install -g vercel
          vercel deploy --prod --token ${{ secrets.VERCEL_TOKEN }}
        working-directory: frontend
      
      # Deploy Backend
      - name: Deploy Backend to Firebase
        run: |
          npm install -g firebase-tools
          firebase deploy --token ${{ secrets.FIREBASE_TOKEN }}
        working-directory: frontend
```

### Required GitHub Secrets
- `VERCEL_TOKEN`: From Vercel Account Settings
- `FIREBASE_TOKEN`: From `firebase login:ci`

---

## Monitoring & Maintenance

### Firestore
- Monitor quota usage: Firebase Console > Firestore > Usage
- Optimize indexes: Check "Single-field index statistics"
- Backup: Enable automated backups in Firestore settings

### Storage
- Monitor file quota: Firebase Console > Storage > Overview
- Remove old/unused files periodically
- Review signed URL expiration times (currently 7 days)

### Cloud Functions
- Monitor execution time: Firebase Console > Functions > Overview
- Check error rates: Firebase Console > Functions > Logs
- Set up alerts for failures in Google Cloud Console

---

## Cost Optimization

The current setup uses Firebase free tier:
- **Firestore**: 1GB data + 50k reads/day
- **Storage**: 5GB total + 1GB/month download
- **Cloud Functions**: 2M invocations/month
- **Authentication**: Up to 50k users

Estimated cost for 1,000 active users:
- Firestore: ~$0-25/month (overage)
- Storage: $0-5/month
- Cloud Functions: $0-5/month
- **Total**: $0-35/month (usually free tier)

Monitor usage in Google Cloud Console > Billing.

---

## Support & Documentation

- [Firebase Documentation](https://firebase.google.com/docs)
- [Vercel Documentation](https://vercel.com/docs)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security)
- [Cloud Functions Guide](https://firebase.google.com/docs/functions)
