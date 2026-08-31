@@
   app.post("/auth/register", (req, res) => {
     if (rateLimited(req, res)) return;
     const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
     const invalid = validateCredentials(username, password);
     if (invalid) {
       res.status(400).json({ error: invalid });
       return;
     }
-    try {
-      const user = createUser(username as string, password as string);
-      const token = createSession(user.id);
-      res.json({ token, username: user.username });
-    } catch (err) {
+    (async () => {
+      try {
+        const user = await createUser(username as string, password as string);
+        const token = createSession(user.id);
+        res.json({ token, username: user.username });
+      } catch (err) {
         if (err instanceof UsernameTakenError) {
           res.status(409).json({ error: err.message });
           return;
         }
         console.error("[/auth/register] error:", err);
         res.status(500).json({ error: "Could not create the account. Try again." });
       }
+    })();
   });
@@
   app.post("/auth/login", (req, res) => {
     if (rateLimited(req, res)) return;
     const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
     if (typeof username !== "string" || typeof password !== "string") {
       res.status(400).json({ error: "Username and password are required." });
       return;
     }
-    const user = findUser(username);
-    // One generic message and one code for both "no such user" and "wrong
-    // password", so the endpoint never reveals which usernames exist. Every
-    // failure is metered so the short-lived guess budget applies here too.
-    if (!user || !verifyPassword(password, user.password_hash)) {
+    (async () => {
+      const user = findUser(username);
+      // One generic message and one code for both "no such user" and "wrong
+      // password", so the endpoint never reveals which usernames exist. Every
+      // failure is metered so the short-lived guess budget applies here too.
+      if (!user || !(await verifyPassword(password, user.password_hash))) {
         if (failedAuthOverLimit(req.ip ?? "unknown")) {
           res.status(429).json({ error: "Too many attempts — try again later." });
           return;
         }
         res.status(401).json({ error: "Wrong username or password." });
         return;
       }
       const token = createSession(user.id);
       res.json({ token, username: user.username });
+    })();
   });
@@
   app.get("/auth/me", (_req, res) => {
     res.json({ username: res.locals.username as string });
   });
