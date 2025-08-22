import React, { JSX, useEffect, useState, useCallback } from 'react';
import {
  Text,
  StyleSheet,
  View,
  FlatList,
  Alert,
  TouchableOpacity,
  RefreshControl,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import firebaseService from './services/firebase.service';
import messaging from '@react-native-firebase/messaging';
import PushNotification from 'react-native-push-notification';
import { showLocalNotification } from './services/NotificationService';
import database from '@react-native-firebase/database';

interface Ride {
  id: string;
  pickupLocation: string;
  destinationLocation: string;
  status: string;
  createdAt?: number;
  updatedAt?: number;
}

// RideCard component (same as before)
const RideCard = ({ ride, onStatusUpdate }: { ride: Ride; onStatusUpdate: (rideId: string, newStatus: string) => void }) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Accepted': return '#4CAF50';
      case 'Rejected': return '#F44336';
      case 'Requested': return '#FF9800';
      default: return '#666';
    }
  };

  const handleStatusUpdate = (newStatus: string) => {
    Alert.alert('Update Status', `Mark this ride as ${newStatus}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Update', onPress: () => onStatusUpdate(ride.id, newStatus) },
    ]);
  };

  return (
    <View style={styles.card}>
      <View style={styles.inlineRow}>
        <Text style={styles.locationLabel}>From: </Text>
        <Text style={styles.locationText}>{ride.pickupLocation}</Text>
      </View>
      <View style={styles.inlineRow}>
        <Text style={styles.locationLabel}>To: </Text>
        <Text style={styles.locationText}>{ride.destinationLocation}</Text>
      </View>
      <View style={styles.inlineRow}>
        <Text style={styles.statusLabel}>Status: </Text>
        <Text style={[styles.statusText, { color: getStatusColor(ride.status) }]}>{ride.status}</Text>
      </View>
      {ride.status === 'Requested' && (
        <View style={styles.actionContainer}>
          <TouchableOpacity style={[styles.actionButton, styles.acceptButton]} onPress={() => handleStatusUpdate('Accepted')}>
            <Text style={styles.actionButtonText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionButton, styles.rejectButton]} onPress={() => handleStatusUpdate('Rejected')}>
            <Text style={styles.actionButtonText}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const App = (): JSX.Element => {
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // --- Push notifications setup ---
  useEffect(() => {
    let unsubscribeOnMessage: (() => void) | null = null;
    let unsubscribeTokenRefresh: (() => void) | null = null;

    const initPush = async () => {
      try {
        // Android 13+ permission
        const version = typeof Platform.Version === 'string' ? parseInt(Platform.Version, 10) : Platform.Version;
        if (Platform.OS === 'android' && version >= 33) {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        }

        await messaging().registerDeviceForRemoteMessages();
        const token = await messaging().getToken();
        console.log('✅ Driver FCM token:', token);

        // Foreground messages
        unsubscribeOnMessage = messaging().onMessage(async remoteMessage => {
          console.log('📩 Foreground message:', remoteMessage);
          showLocalNotification(remoteMessage.notification?.title ?? 'New Ride', remoteMessage.notification?.body ?? '');
        });

        // PushNotification config
        PushNotification.configure({
          onNotification: notification => console.log('LOCAL NOTIFICATION:', notification),
          requestPermissions: Platform.OS === 'android',
        });

        PushNotification.createChannel(
          { channelId: 'rides-channel', channelName: 'Rides Notifications', importance: 4 },
          created => console.log(`Channel created: ${created}`)
        );

        // Token refresh
        unsubscribeTokenRefresh = messaging().onTokenRefresh(newToken => console.log('♻️ Token refreshed:', newToken));
      } catch (err) {
        console.error('❌ Push init error:', err);
      }
    };

    initPush();
    return () => {
      if (unsubscribeOnMessage) unsubscribeOnMessage();
      if (unsubscribeTokenRefresh) unsubscribeTokenRefresh();
    };
  }, []);
  
useEffect(() => {
  const ridesRef = database().ref('/rides');

  // Track existing ride IDs
  const existingRideIds: Set<string> = new Set();

  // Fetch current rides once and mark them as existing
  ridesRef.once('value', snapshot => {
    snapshot.forEach(child => {
  existingRideIds.add(child.key ?? '');
  return undefined; // <- satisfies TS type
});
  });

  // Listen for child_added
  const handleChildAdded = (snapshot: any) => {
    const ride = snapshot.val();
    if (!ride) return;

    const rideId = snapshot.key;
    if (!rideId) return;
    // Skip if already exists
      if (existingRideIds.has(rideId)) return;

      existingRideIds.add(rideId);

    // Add this ride to existing set to avoid duplicate notifications
    existingRideIds.add(rideId);

    // Show local notification for new ride
    PushNotification.localNotification({
      channelId: 'rides-channel',
      title: 'New Ride Requested',
      message: `Pickup: ${ride.pickupLocation}, Destination: ${ride.destinationLocation}`,
      playSound: true,
      soundName: 'default',
    });
  };

  ridesRef.on('child_added', handleChildAdded);

  return () => {
    ridesRef.off('child_added', handleChildAdded);
  };
}, []);


  // --- Load initial rides ---
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const initializeApp = async () => {
      try {
        await firebaseService.initialize();
        const initialRides = await firebaseService.getRides();
        setRides(initialRides ?? []);
        unsubscribe = firebaseService.subscribeToRides(updatedRides => setRides(updatedRides));
        setLoading(false);
      } catch (err) {
        console.error('❌ Init error:', err);
        setLoading(false);
      }
    };

    initializeApp();
    return () => { if (unsubscribe) unsubscribe(); };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const refreshedRides = await firebaseService.getRides();
      setRides(refreshedRides ?? []);
    } catch (err) {
      console.error('❌ Refresh error:', err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleStatusUpdate = async (rideId: string, newStatus: string) => {
    try {
      const success = await firebaseService.updateRideStatus(rideId, newStatus);
      if (success) Alert.alert('✅ Success', `Ride status updated to ${newStatus}`);
      else Alert.alert('❌ Error', 'Failed to update ride status');
    } catch (err) {
      console.error('❌ Update status error:', err);
      Alert.alert('Error', 'Failed to update ride status');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.loadingText}>Loading rides...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>All Rides</Text>
      {rides.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No rides available</Text>
        </View>
      ) : (
        <FlatList
          data={rides}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <RideCard ride={item} onStatusUpdate={handleStatusUpdate} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContainer}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginVertical: 20 },
  loadingText: { fontSize: 18, color: '#666', textAlign: 'center', marginTop: 100 },
  listContainer: { paddingHorizontal: 16, paddingBottom: 20 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, elevation: 5 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  locationLabel: { fontSize: 14, fontWeight: '600', color: '#666' },
  locationText: { fontSize: 16, fontWeight: '500', color: '#333' },
  statusLabel: { fontSize: 14, fontWeight: '600', color: '#666' },
  statusText: { fontSize: 16, fontWeight: '600' },
  actionContainer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#eee' },
  actionButton: { flex: 1, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 6, marginHorizontal: 4, alignItems: 'center' },
  acceptButton: { backgroundColor: '#4CAF50' },
  rejectButton: { backgroundColor: '#F44336' },
  actionButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  emptyText: { fontSize: 20, fontWeight: '600', color: '#666', marginBottom: 8 },
});

export default App;
