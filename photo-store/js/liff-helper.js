window.AppLIFF = {
  profile: null,
  isReady: false,

  async init() {
    try {
      if (!window.liff) {
        console.warn("LIFF SDK not loaded");
        return null;
      }

      if (!window.CONFIG || !CONFIG.LIFF_ID) {
        console.warn("LIFF_ID not found in CONFIG");
        return null;
      }

      await liff.init({
        liffId: CONFIG.LIFF_ID
      });

      this.isReady = true;

      if (!liff.isLoggedIn()) {
        liff.login({
          redirectUri: window.location.href
        });
        return null;
      }

      const profile = await liff.getProfile();
      this.profile = profile;

      localStorage.setItem("line_user_id", profile.userId);
      localStorage.setItem("line_display_name", profile.displayName || "");
      localStorage.setItem("line_picture", profile.pictureUrl || "");

      return profile;

    } catch (err) {
      console.error("LIFF init error:", err);
      return null;
    }
  },

  getProfile() {
    return this.profile;
  },

  getLineUserId() {
    return localStorage.getItem("line_user_id") || "";
  },

  getDisplayName() {
    return localStorage.getItem("line_display_name") || "";
  },

  getPictureUrl() {
    return localStorage.getItem("line_picture") || "";
  },

  getCartKey() {
    const userId = this.getLineUserId() || "guest";
    return `photo_cart_${userId}`;
  },

  clearUser() {
    localStorage.removeItem("line_user_id");
    localStorage.removeItem("line_display_name");
    localStorage.removeItem("line_picture");
    this.profile = null;
  }
};
