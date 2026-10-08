// Roomie+ settings. This is the only file you need to edit.
window.ROOMIE_CONFIG = {

  // SYNC BETWEEN ROOMMATES
  // Leave this as null and Roomie+ keeps everything on one phone.
  // To sync, replace null with the "firebaseConfig" block from your Firebase project
  // (Firebase console > Project settings > Your apps > Web app). It looks like this:
  //
  //   firebase: {
  //     apiKey: "AIza...",
  //     authDomain: "your-project.firebaseapp.com",
  //     projectId: "your-project",
  //     storageBucket: "your-project.appspot.com",
  //     messagingSenderId: "1234567890",
  //     appId: "1:1234567890:web:abc123"
  //   }
  //
  // These values are not secret. They only say which Firebase project to talk to.
  firebase: null

  // RECEIPT SCANNING needs no setting here. It switches on by itself once you add
  // ANTHROPIC_API_KEY to your Cloudflare Pages project (see README, step 4).
};
