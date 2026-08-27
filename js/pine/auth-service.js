// Pine Auth Service
const PineAuth = {
  async signInWithOtp(email) {
    const { error } = await pineSupabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + PINE_CONFIG.BASE_PATH + '/pages/pine.html',
      },
    });
    if (error) throw error;
  },

  async verifyOtp(email, token) {
    const { data, error } = await pineSupabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    if (error) throw error;
    return data;
  },

  async getSession() {
    const { data: { session } } = await pineSupabase.auth.getSession();
    return session;
  },

  async getUser() {
    const { data: { user } } = await pineSupabase.auth.getUser();
    return user;
  },

  onAuthChange(callback) {
    return pineSupabase.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  },

  async signOut() {
    await pineSupabase.auth.signOut();
  },
};
