/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Initialize Firebase for background message handling
import messaging from '@react-native-firebase/messaging';

// Handle background messages
messaging().setBackgroundMessageHandler(async remoteMessage => {
  console.log('Message handled in the background!', remoteMessage);
  // You can add custom logic here for background message handling
});

AppRegistry.registerComponent(appName, () => App);
