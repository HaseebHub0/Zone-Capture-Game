import React from "react";
import { SafeAreaView, StatusBar, StyleSheet, Text, View, Pressable, Linking } from "react-native";
import Constants from "expo-constants";
import { WebView } from "react-native-webview";

const multiplayerUrl =
  Constants.expoConfig?.extra?.multiplayerUrl ||
  "https://YOUR_RENDER_DOMAIN";

export default function App() {
  const isConfigured = !multiplayerUrl.includes("YOUR_RENDER_DOMAIN");

  if (!isConfigured) {
    return (
      <SafeAreaView style={styles.shell}>
        <StatusBar barStyle="light-content" />
        <View style={styles.card}>
          <Text style={styles.title}>Zone Clash Arena</Text>
          <Text style={styles.text}>
            Render deploy URL set karni baqi hai. `app.json` me `expo.extra.multiplayerUrl`
            ko live HTTPS domain se update karein.
          </Text>
          <Pressable style={styles.button} onPress={() => Linking.openURL("https://render.com/")}>
            <Text style={styles.buttonText}>Open Render</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.shell}>
      <StatusBar barStyle="light-content" />
      <WebView
        source={{ uri: multiplayerUrl }}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        startInLoadingState
        originWhitelist={["*"]}
        style={styles.webview}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: "#08111a"
  },
  webview: {
    flex: 1,
    backgroundColor: "#08111a"
  },
  card: {
    margin: 24,
    padding: 20,
    borderRadius: 24,
    backgroundColor: "#0d1723"
  },
  title: {
    color: "#eef8ff",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 12
  },
  text: {
    color: "#9eb8cb",
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 18
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: "#62f2d0",
    alignSelf: "flex-start"
  },
  buttonText: {
    color: "#041118",
    fontWeight: "800",
    fontSize: 16
  }
});
