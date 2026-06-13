# 🎓 StudentMS — Complete Setup Guide

**Production-Ready School Student Management System**  
Firebase + Google Drive + Vanilla JS — No paid services

---

## 📁 Folder Structure

```
StudentMS/
├── index.html                     ← Entry point (smart redirect)
├── login.html                     ← Authentication page
├── dashboard.html                 ← Main dashboard & student management
├── firebase.json                  ← Firebase Hosting + deployment config
├── firestore.rules                ← Firestore security rules
├── firestore.indexes.json         ← Firestore performance indexes
├── storage.rules                  ← Firebase Storage security rules
├── SETUP.md                       ← This file
│
└── assets/
    ├── css/
    │   └── style.css              ← Complete design system (dark/light)
    │
    ├── js/
    │   ├── firebase/
    │   │   └── config.js          ← Firebase + app configuration
    │   │
    │   ├── services/
    │   │   ├── auth.service.js    ← Authentication (sign in/out, roles)
    │   │   ├── student.service.js ← CRUD, pagination, real-time sync
    │   │   └── drive.service.js   ← Google Drive API + Excel export
    │   │
    │   └── utils/
    │       ├── helpers.js         ← Date, image, toast, modal utilities
    │       └── security.js        ← XSS protection, validation, sanitization
    │
    └── images/                    ← Static assets (favicon, logos, etc.)
```

---

## ⚙️ Step 1 — Firebase Setup (Free Spark Plan)

### 1.1 Create Firebase Project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → give it a name (e.g., `studentms-school`)
3. Disable Google Analytics (optional) → Create project

### 1.2 Enable Authentication

1. In Firebase Console → **Authentication** → **Get started**
2. Click **Sign-in method** tab
3. Enable **Email/Password** → Save

### 1.3 Create Firestore Database

1. **Firestore Database** → **Create database**
2. Select **Start in production mode** (you'll apply rules below)
3. Choose a region close to your users (e.g., `asia-south1` for India)

### 1.4 Enable Firebase Storage

1. **Storage** → **Get started**
2. Start in **production mode**
3. Choose the same region as Firestore

### 1.5 Get Your Firebase Config

1. **Project Settings** (⚙️ gear icon) → **General**
2. Scroll to **Your apps** → Click `</>` (Web app)
3. Register app (name it "StudentMS Web")
4. Copy the `firebaseConfig` object

### 1.6 Paste Config in `assets/js/firebase/config.js`

```javascript
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",          // your actual value
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "123456789012",
  appId:             "1:123456789012:web:abcdef",
  measurementId:     "G-XXXXXXXX"          // optional
};
```

---

## ☁️ Step 2 — Google Drive API Setup (Free)

### 2.1 Create Google Cloud Project

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use existing)
3. **APIs & Services** → **Library**
4. Search "Google Drive API" → Enable it

### 2.2 Create OAuth 2.0 Credentials

1. **APIs & Services** → **Credentials**
2. **Create Credentials** → **OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Name: "StudentMS"
5. **Authorized JavaScript Origins**:
   - `http://localhost` (for local dev)
   - `https://your-project.web.app` (for Firebase Hosting)
   - `https://your-custom-domain.com` (if using custom domain)
6. **Authorized Redirect URIs**: same URLs as above
7. Click Create → copy the **Client ID**

### 2.3 Configure OAuth Consent Screen

1. **APIs & Services** → **OAuth consent screen**
2. User Type: **External** → Create
3. App name: "StudentMS", add your email
4. Scopes: add `../auth/drive.file` and `../auth/drive.metadata.readonly`
5. Add your email as test user (while in testing mode)

### 2.4 Paste Client ID in config.js

```javascript
const GOOGLE_CLIENT_ID = "123456789-abcdefg.apps.googleusercontent.com";
```

---

## 🔒 Step 3 — Deploy Security Rules

### Install Firebase CLI

```bash
npm install -g firebase-tools
firebase login
firebase init   # select Hosting, Firestore, Storage
```

### Deploy rules

```bash
# From the StudentMS/ folder:
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only storage
```

---

## 🚀 Step 4 — First Admin Account

1. Open your site → click **"First time? Create admin account"**
2. Enter your name, email, and a strong password
3. Click **Create Admin & Sign In**
4. You'll be redirected to the dashboard automatically

> ⚠️ The setup link only works when creating the FIRST account.  
> After that, use the normal sign-in form.

---

## 🌐 Step 5 — Deploy to Firebase Hosting

```bash
# From the StudentMS/ folder:
firebase deploy --only hosting
```

Your app will be live at:  
`https://your-project-id.web.app`

For a custom domain:  
**Firebase Console** → **Hosting** → **Add custom domain**

---

## 🗄️ Firestore Data Structure

```
students/                          ← Collection
  {auto-id}/                       ← Document
    id:             "auto-id"
    name:           "Rahul Das"
    studentId:      "STU1001"
    className:      "Class 10"
    section:        "A"
    rollNo:         "42"
    gender:         "Male"
    dob:            "2008-05-15"
    bloodGroup:     "B+"
    fatherName:     "Rajesh Das"
    motherName:     "Priya Das"
    guardianName:   ""
    guardianRelation: ""
    contactNo:      "+91 98765 43210"
    aadhaarNo:      "1234-5678-9012"   ← stored normalized
    address:        "Village, District, State - PIN"
    session:        "2024-25"
    academicYear:   "2024"
    stream:         "Science"
    subjects:       "Mathematics, Physics, Chemistry"
    schoolName:     "ABC High School"
    photoUrl:       "https://firebasestorage..."
    photoPath:      "students/{id}/RahulDas_STU1001.jpg"
    isActive:       true
    createdAt:      Timestamp
    updatedAt:      Timestamp
    createdBy:      "uid"

users/                             ← Collection
  {uid}/                           ← Document
    email:          "admin@school.edu"
    displayName:    "Admin"
    role:           "admin"        ← "admin" | "viewer"
    createdAt:      Timestamp

settings/                          ← Collection (future use)
  appConfig/
    ...
```

---

## 📱 Features

| Feature | Status |
|---------|--------|
| Mobile, Tablet, Desktop responsive | ✅ |
| Dark / Light theme | ✅ |
| Firebase Authentication | ✅ |
| Real-time Firestore sync | ✅ |
| Firebase Storage (photos) | ✅ |
| Google Drive export (Excel + images) | ✅ |
| Add / Edit / Delete / View students | ✅ |
| Camera capture (front + rear) | ✅ |
| File upload with image compression | ✅ |
| Pagination (25 / 50 / 100 / 200 per page) | ✅ |
| Search (debounced, multi-field) | ✅ |
| Filter by Class / Section / Status | ✅ |
| Sortable columns | ✅ |
| Bulk select + bulk delete + bulk export | ✅ |
| Excel export (SheetJS) | ✅ |
| Excel import | ✅ |
| XSS protection + input sanitization | ✅ |
| Aadhaar masking in export | ✅ |
| Duplicate Student ID / Aadhaar prevention | ✅ |
| Soft delete (archive) + hard delete | ✅ |
| Offline persistence (Firestore) | ✅ |
| Toast notifications | ✅ |
| Loading skeletons | ✅ |
| Animated stat counters | ✅ |
| Confirmation modals | ✅ |
| ARIA accessibility labels | ✅ |

---

## 🔧 Customization

### Change subjects list
Edit `SUBJECTS_LIST` array in `dashboard.html` (inline script near the top).

### Change items per page default
Edit `ITEMS_PER_PAGE_DEFAULT` in `config.js`.

### Change image compression settings
Edit `MAX_IMAGE_DIMENSION` and `JPEG_QUALITY` in `config.js`.

### Change Drive folder names
Edit `DRIVE_ROOT_FOLDER`, `DRIVE_EXCEL_FOLDER`, `DRIVE_IMAGES_FOLDER` in `config.js`.

---

## 🐛 Troubleshooting

| Problem | Fix |
|---------|-----|
| "Firebase not initialized" | Check `config.js` values; all placeholders replaced? |
| Login fails | Check Firebase Auth → Email/Password is enabled |
| Photos not uploading | Check Storage rules deployed; bucket name correct? |
| Drive not connecting | Verify OAuth Origins include your exact URL (no trailing slash) |
| Firestore permission denied | Deploy `firestore.rules` first |
| Import not working | Excel headers must match exactly (see `drive.service.js`) |
| Camera not working | Must be served over HTTPS or localhost |

---

## 📜 License

Free for educational and personal use.  
For commercial school deployments, ensure compliance with your local data protection laws (e.g., DPDP Act for India).

---

*StudentMS v2.0.0 — Built with Firebase, Vanilla JS, and love for education 🎓*
