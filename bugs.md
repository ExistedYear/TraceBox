# Known Issues & Feature Gaps

## 1. GitHub OAuth Authentication
- **Observation**: Clicking **"Continue with GitHub"** fails or redirects with an error when used on a fresh Supabase instance.
- **Root Cause**: GitHub OAuth requires external credentials that live outside the repository in GitHub Developer Settings and the Supabase Dashboard.
- **Setup Requirements**:
  1. **GitHub Developer Settings** (`https://github.com/settings/developers` → OAuth Apps):
     - **Homepage URL**: `http://localhost:3000` (or `https://<your-vercel-domain>.vercel.app`)
     - **Authorization callback URL**:
       ```text
       https://<your-supabase-project-ref>.supabase.co/auth/v1/callback
       ```
     - Copy **Client ID** and generate a **Client Secret**.
  2. **Supabase Dashboard** (`Authentication` → `Providers` → `GitHub`):
     - Enable GitHub provider and paste `Client ID` and `Client Secret`.
  3. **Supabase URL Configuration** (`Authentication` → `URL Configuration`):
     - **Site URL**: `https://<your-vercel-domain>.vercel.app` (or `http://localhost:3000`)
     - **Redirect URLs**:
       - `https://<your-vercel-domain>.vercel.app/**`
       - `http://localhost:3000/**`

---

## 2. Forgot Password / Password Reset Flow
- **Observation**: There is currently no "Forgot password?" recovery link or password reset flow on the `/login` screen.
- **Status**: Scheduled feature enhancement.
- **Implementation Plan**:
  1. Add a "Forgot password?" link on `/login` routing to `/forgot-password`.
  2. Create `ForgotPasswordForm` calling `supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/reset-password` })`.
  3. Add `/reset-password` page with `ResetPasswordForm` calling `supabase.auth.updateUser({ password: newPassword })`.

## 3. Confirm Password during SignUp does not exist.
