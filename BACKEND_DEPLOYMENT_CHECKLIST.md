# Backend Deployment Checklist

## Pre-Deployment Verification ✓

### Repository State
- [x] All code committed to GitHub
- [x] `frontend/` directory contains all frontend code
- [x] `backend/` directory contains local processing engines
- [x] `frontend/functions/` contains Cloud Functions
- [x] `frontend/firebase.json` configured correctly
- [x] `frontend/.firebaserc` set to warranty-intelligence-system project

### Firebase Project
- [x] Firebase project created: `warranty-intelligence-system`
- [x] Firebase Console accessible
- [x] Project has following services enabled:
  - [x] Firestore
  - [x] Cloud Functions
  - [x] Cloud Storage
  - [x] Authentication

### Configuration Files
- [x] `frontend/firebase.json` - Defines Firestore, Storage, Functions config
- [x] `frontend/firestore.rules` - Firestore security rules
- [x] `frontend/firestore.indexes.json` - Firestore composite indexes
- [x] `frontend/storage.rules` - Storage security rules
- [x] `frontend/functions/index.js` - Cloud Functions code
- [x] `frontend/functions/package.json` - Functions dependencies
- [x] `frontend/.firebaserc` - Firebase project reference

### Dependencies
- [x] `firebase-admin@12.7.0` - Firebase admin SDK
- [x] `firebase-functions@4.9.0` - Functions framework
- [x] `busboy@1.6.0` - Multipart form parsing

### Code Quality
- [x] `frontend/functions/index.js` - No syntax errors ✓
- [x] `frontend/firestore.rules` - Valid Firestore security syntax
- [x] `frontend/storage.rules` - Valid Storage security syntax

---

## Deployment Steps (TO BE EXECUTED WITH AUTHENTICATION)

### Step 1: Authenticate with Firebase
```bash
firebase login
# Opens browser for Google authentication
# Verify: firebase projects:list
```
**Expected Output**: Should list `warranty-intelligence-system` project

### Step 2: Set Active Project
```bash
cd frontend
firebase use warranty-intelligence-system
```
**Expected Output**: `Now using project warranty-intelligence-system`

### Step 3: Deploy Firestore Rules
```bash
firebase deploy --only firestore:rules
```
**Expected Output**: 
```
✔ firestore:rules - Updating rules for database [(default)]...
✔ Rules updated in <X>s.
```

### Step 4: Deploy Storage Rules
```bash
firebase deploy --only storage
```
**Expected Output**: 
```
✔ storage.rules - Updating rules at gs://warranty-intelligence-system.firebasestorage.app
✔ Rules updated in <X>s.
```

### Step 5: Deploy Cloud Functions
```bash
firebase deploy --only functions
```
**Expected Output**:
```
✔ functions[healthCheck] Successful
✔ functions[uploadInvoice] Successful
✔ All functions deployed successfully
```

### Step 6: Deploy Everything (Alternative)
```bash
firebase deploy
```
**Expected Output**: Deploys firestore, storage, and functions together

---

## Post-Deployment Verification

### Cloud Functions
```bash
# List deployed functions
firebase functions:list

# Get function URLs
firebase functions:list --json | jq '.[] | .trigger.httpsTrigger.url'
```

### Firestore
```bash
# Check Firestore is active
curl -X POST https://firestore.googleapis.com/v1/projects/warranty-intelligence-system/databases/\(default\)/documents/users
```

### Storage
```bash
# Test storage is writable
curl -X POST https://firebasestorage.googleapis.com/upload?uploadType=media&name=test
```

---

## Cloud Functions API Endpoints

After deployment, functions will be available at:

```
Region-specific URLs (e.g., us-central1):
https://us-central1-warranty-intelligence-system.cloudfunctions.net

Available endpoints:
1. healthCheck
   URL: https://region-warranty-intelligence-system.cloudfunctions.net/healthCheck
   Method: GET/OPTIONS
   Returns: { status: 'ok', maxFileSizeMB: 3, allowedTypes: [...] }

2. uploadInvoice
   URL: https://region-warranty-intelligence-system.cloudfunctions.net/uploadInvoice
   Method: POST (multipart/form-data)
   Headers: Authorization: Bearer <id-token>
   Body: file field named "invoice"
   Returns: { success: true, url, path, sizeBytes }
```

---

## Frontend Integration

After Cloud Functions deployment:

1. **Update frontend .env** (if using VITE_API_BASE_URL):
```dotenv
VITE_API_BASE_URL=https://region-warranty-intelligence-system.cloudfunctions.net
```

2. **Redeploy frontend to Vercel**:
```bash
# Push changes to GitHub main branch
git add .env
git commit -m "Update Cloud Functions endpoint"
git push origin main
# Vercel auto-redeploys on push
```

3. **Test integration**:
   - Navigate to production URL
   - Sign in with Firebase Authentication
   - Test file upload feature
   - Verify files appear in Firebase Storage console

---

## Firestore Collections Schema

After deployment, create these collections in Firestore:

### users/{userId}
```json
{
  "email": "user@example.com",
  "displayName": "User Name",
  "photoURL": "https://...",
  "createdAt": "2026-01-01T00:00:00Z",
  "preferences": {
    "theme": "dark",
    "notifications": true
  }
}
```

### products/{productId}
```json
{
  "userId": "auth-uid",
  "productName": "Device Name",
  "category": "Electronics",
  "purchaseDate": "2025-01-01T00:00:00Z",
  "warrantyExpiration": "2028-01-01T00:00:00Z",
  "invoiceUrl": "gs://bucket/users/uid/invoices/...",
  "createdAt": "2026-01-01T00:00:00Z"
}
```

### products/{productId}/repairs/{repairId}
```json
{
  "date": "2026-01-15T00:00:00Z",
  "description": "Screen replacement",
  "cost": 150.00,
  "vendor": "Repair Shop",
  "warrantyApplied": true
}
```

### notifications/{notificationId}
```json
{
  "userId": "auth-uid",
  "type": "warranty_expiring",
  "productId": "product-id",
  "message": "Your warranty expires in 30 days",
  "read": false,
  "createdAt": "2026-01-01T00:00:00Z"
}
```

---

## Security Rules Summary

### Firestore Rules
- ✓ All reads/writes require authentication
- ✓ Users can only access their own documents
- ✓ Products linked to userId ownership
- ✓ Repairs linked through product ownership
- ✓ Notifications user-isolated
- ✓ DEFAULT DENY for all other paths

### Storage Rules
- ✓ All access requires authentication
- ✓ User isolation by `/users/{userId}/` prefix
- ✓ Invoices: 3MB max, PDF/JPG/PNG/WEBP only
- ✓ Avatars: 1MB max, images only
- ✓ DEFAULT DENY for all other paths

---

## Rollback Procedure

If deployment causes issues:

```bash
cd frontend

# Rollback to previous rules
firebase deploy --only firestore:rules,storage
# (Rules are stored in Firebase; redeploying old files reverts changes)

# Rollback Cloud Functions
firebase deploy --only functions
# (Functions code is in GitHub; switch branch then redeploy)
```

---

## Monitoring After Deployment

### Daily Checks
```bash
# View recent errors
firebase functions:log --limit 50

# Check quota usage
firebase firestore:usage
```

### Firebase Console Checks
1. Firestore > Data tab - Verify collections exist
2. Storage > Files tab - Verify uploads work
3. Functions > Overview - Check execution stats
4. Authentication > Users - Verify user count

### Set Up Alerts (Google Cloud Console)
1. Go to Google Cloud Console
2. Select `warranty-intelligence-system` project
3. Create alerts for:
   - Functions error rate > 5%
   - Functions response time > 5s
   - Firestore read quota > 80%
   - Storage quota > 80%

---

## Logs & Debugging

### View Cloud Functions Logs
```bash
firebase functions:log
firebase functions:log --limit 100
firebase functions:log --function uploadInvoice
```

### View Error Details
```bash
firebase functions:log --tail
# (Streams logs in real-time)
```

### Test Functions Locally
```bash
firebase emulators:start
# Frontend at http://localhost:5000
# Emulators Dashboard at http://localhost:4000
```

---

## Maintenance Schedule

- **Daily**: Monitor error logs via Firebase Console
- **Weekly**: Review quota usage, check for failed uploads
- **Monthly**: Update dependencies, review security rules
- **Quarterly**: Review analytics, optimize indexes

---

## Contact & Support

- Firebase Support: https://firebase.google.com/support
- GitHub Issues: Create issue in repository
- Cloud Console Alerts: https://console.cloud.google.com/monitoring/alerting
