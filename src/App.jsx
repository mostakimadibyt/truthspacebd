```react
import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  onSnapshot, 
  doc, 
  updateDoc, 
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  increment,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';
import { 
  getDatabase, 
  ref, 
  set, 
  push,
  update,
  onValue, 
  onDisconnect, 
  serverTimestamp as rtdbTimestamp
} from 'firebase/database';
import { 
  MessageCircle, Heart, Repeat2, Share, Image as ImageIcon, 
  User, LogOut, X, Search, Trash2,
  Send, BadgeCheck, Sparkles, Wand2, Loader2, Home, Compass, Settings, Sun, Moon, ChevronLeft, Camera, Bell, PlusCircle,
  UserPlus, Video as VideoIcon, ArrowRight, CheckCircle2, Lightbulb, Type, RefreshCw, Zap, Star, Calendar
} from 'lucide-react';

/**
 * ====================================================================
 * 1. CONFIGURATION (ORIGINAL RESTORED)
 * ====================================================================
 */
const firebaseConfig = {
  apiKey: "AIzaSyDldd1Ma7qk-S2gh_QljrHYBkco0TN7xkA",
  authDomain: "mostakim-adib.firebaseapp.com",
  projectId: "mostakim-adib",
  storageBucket: "mostakim-adib.firebasestorage.app",
  messagingSenderId: "604298380078",
  appId: "1:604298380078:web:generated_id",
  databaseURL: "https://mostakim-adib-default-rtdb.firebaseio.com"
};

const GEMINI_API_KEY = ""; // Environment handles this
const CLOUD_NAME = "dp7lfrigq"; 
const UPLOAD_PRESET = "Truthspace"; 

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

const COLL = { USERS: 'users', POSTS: 'posts', USERNAMES: 'usernames', FOLLOWS: 'follows', COMMENTS: 'comments' };

// ====================================================================
// 2. HELPERS & UTILITIES
// ====================================================================

const formatCount = (n) => {
  if (!n) return 0;
  if (n < 1000) return n;
  if (n >= 1000 && n < 1000000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  if (n >= 1000000 && n < 1000000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  return (n / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
};

const formatTime = (isoString) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diff = (now - date) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  if (diff < 31536000) return `${Math.floor(diff / 604800)}w`;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

// --- IMAGE OPTIMIZATION LOGIC ---
const getHighResUrl = (url) => {
  if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) return url;
  if (url.includes('/upload/') && !url.includes('f_auto')) {
    return url.replace('/upload/', '/upload/f_auto,q_auto/');
  }
  return url;
};

const getLowResUrl = (url) => {
  if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) return url;
  if (url.includes('/upload/') && !url.includes('w_50')) {
    return url.replace('/upload/', '/upload/w_50,e_blur:1000,q_1/');
  }
  return url;
};

const uploadToCloudinary = async (file, onProgress) => {
  if (!file) return null;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);
  
  const resourceType = file.type.startsWith('video/') ? 'video' : 'image';

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        resolve(data.secure_url);
      } else {
        try {
            const errorData = JSON.parse(xhr.responseText);
            reject(new Error(errorData.error?.message || 'Upload failed'));
        } catch (e) {
            reject(new Error(`Upload failed: ${xhr.statusText}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
};

const callGemini = async (prompt, retries = 3) => {
  const apiKey = typeof GEMINI_API_KEY !== 'undefined' ? GEMINI_API_KEY : ""; 
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      if (response.status === 503) { await new Promise(res => setTimeout(res, 1000 * (i + 1))); continue; }
      if (!response.ok) return null;
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text;
    } catch (error) { 
      if (i === retries - 1) return null; 
    }
  }
  return null;
};

// --- NOTIFICATION LOGIC ---
const createNotification = async (recipientId, type, sender, postId = null, postContent = null) => {
  if (!recipientId || recipientId === sender.uid) return;
  try {
    const notifRef = ref(rtdb, `notifications/${recipientId}`);
    await push(notifRef, {
      fromUserId: sender.uid, 
      senderId: sender.uid,  
      senderName: sender.fullName,
      senderPhoto: sender.photoURL,
      senderVerified: sender.verified || false,
      type, 
      postId,
      postSnippet: postContent ? postContent.substring(0, 60) : '',
      createdAt: rtdbTimestamp(),
      read: false
    });
  } catch (e) { console.error("Notification Error:", e); }
};

const notifyFollowersOfNewPost = async (author, postId, content) => {
  try {
    const q = query(collection(db, COLL.FOLLOWS), where("targetId", "==", author.uid));
    const querySnapshot = await getDocs(q);
    const promises = querySnapshot.docs.map(doc => {
       const followerId = doc.data().followerId;
       return createNotification(followerId, 'new_post', author, postId, content);
    });
    await Promise.all(promises);
  } catch (e) {
    console.error("Error notifying followers:", e);
  }
};

const usePullToRefresh = (onRefresh) => {
  const [startY, setStartY] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const handleTouchStart = (e) => {
      if (window.scrollY === 0) {
        setStartY(e.touches[0].clientY);
      }
    };

    const handleTouchMove = (e) => {
      const y = e.touches[0].clientY;
      if (startY && y > startY && window.scrollY === 0) {
        setPulling(true);
        if (y - startY > 10 && e.cancelable) e.preventDefault(); 
      }
    };

    const handleTouchEnd = async (e) => {
      if (!pulling) return;
      const endY = e.changedTouches[0].clientY;
      if (endY - startY > 80) { 
        setRefreshing(true);
        await onRefresh();
        setTimeout(() => setRefreshing(false), 1000);
      }
      setPulling(false);
      setStartY(0);
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [startY, pulling, onRefresh]);

  return { refreshing, pulling };
};

const useSwipe = (onSwipeRight) => {
  const touchStart = useRef(null);
  const touchEnd = useRef(null);
  const onTouchStart = (e) => { touchEnd.current = null; touchStart.current = e.targetTouches[0].clientX; };
  const onTouchMove = (e) => { touchEnd.current = e.targetTouches[0].clientX; };
  const onTouchEnd = () => {
    if (!touchStart.current || !touchEnd.current) return;
    const distance = touchStart.current - touchEnd.current;
    if (distance < -50 && touchStart.current < 50) { onSwipeRight(); }
  };
  return { onTouchStart, onTouchMove, onTouchEnd };
};

// ====================================================================
// 3. UI COMPONENTS
// ====================================================================

const TruthSpaceLogo = ({ size = 32, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M20 4C11.1634 4 4 11.1634 4 20C4 28.8366 11.1634 36 20 36C28.8366 36 36 28.8366 36 20C36 11.1634 28.8366 4 20 4Z" fill="url(#grad1)"/>
    <path d="M20 4C11.1634 4 4 11.1634 4 20" stroke="white" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.5"/>
    <path d="M12 20H18L22 12L28 20" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="28" cy="20" r="3" fill="white"/>
    <defs><linearGradient id="grad1" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse"><stop stopColor="#2563EB" /><stop offset="1" stopColor="#7C3AED" /></linearGradient></defs>
  </svg>
);

const VerifiedBadge = ({ isVerified }) => {
  if (!isVerified) return null;
  return <BadgeCheck size={16} className="text-blue-500 fill-blue-500/10 ml-1 inline-block align-text-bottom" strokeWidth={2.5} />;
};

const OnlineBadge = ({ userId, size = 'sm' }) => {
  const [status, setStatus] = useState('offline');
  useEffect(() => {
    if (!userId || !rtdb) return;
    const unsub = onValue(ref(rtdb, `status/${userId}/state`), (snap) => setStatus(snap.val() || 'offline'));
    return () => unsub();
  }, [userId]);
  if (status !== 'online') return null;
  return <div className={`absolute bottom-0 right-0 ${size==='lg'?'w-4 h-4 border-4':'w-3 h-3 border-2'} bg-green-500 rounded-full border-zinc-900 z-10 shadow-[0_0_10px_rgba(34,197,94,0.6)]`} />;
};

// --- PREMIUM IMAGE LOADER (With Logo) ---
const MediaWithLoader = ({ src, type = 'image', className, fallbackChar, objectFit = 'cover', ...props }) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  
  // Safe Fallback logic
  const safeSrc = src || '';
  const highResSrc = error && type === 'avatar' 
    ? `https://api.dicebear.com/7.x/avataaars/svg?seed=${fallbackChar || 'user'}` 
    : getHighResUrl(safeSrc);
    
  const lowResSrc = type === 'image' && !error ? getLowResUrl(safeSrc) : null;

  return (
    <div className={`relative overflow-hidden ${className} ${!loaded && !lowResSrc ? 'bg-zinc-800/20' : 'bg-transparent'}`}>
      
      {/* Premium Loader with Logo */}
      {!loaded && !error && (
        <div className={`absolute inset-0 flex flex-col items-center justify-center z-10 transition-opacity duration-500 ${lowResSrc ? 'bg-black/20 backdrop-blur-sm' : 'bg-zinc-900/10 backdrop-blur-md'}`}>
          <div className="relative">
             <TruthSpaceLogo size={32} className="animate-pulse drop-shadow-lg opacity-80" />
          </div>
        </div>
      )}

      {type === 'video' ? (
        <video 
          src={highResSrc} 
          className={`w-full h-full object-${objectFit} transition-opacity duration-700 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoadedData={() => setLoaded(true)}
          onError={() => setError(true)}
          controls
          {...props} 
        />
      ) : (
        <>
            {/* Blurry Placeholder behind */}
            {lowResSrc && !error && (
                <img 
                    src={lowResSrc} 
                    className={`absolute inset-0 w-full h-full object-${objectFit} blur-xl scale-110 transition-opacity duration-1000 ${loaded ? 'opacity-0' : 'opacity-100'}`}
                    alt="placeholder"
                    aria-hidden="true"
                />
            )}
            {/* Main Image */}
            <img 
              src={highResSrc} 
              className={`relative z-10 w-full h-full object-${objectFit} transition-opacity duration-700 ${loaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setLoaded(true)}
              onError={() => { setError(true); setLoaded(true); }}
              referrerPolicy="no-referrer"
              alt="media"
              {...props}
            />
        </>
      )}
    </div>
  );
};

const Loading = ({theme}) => (
  <div className={`flex flex-col items-center justify-center min-h-screen ${theme === 'light' ? 'bg-gray-50' : 'bg-[#050505]'} bg-[url('https://grainy-gradients.vercel.app/noise.svg')]`}>
    <div className="animate-spin mb-4"><TruthSpaceLogo size={64}/></div>
    <p className="text-zinc-500 font-mono tracking-widest text-xs uppercase">Initializing...</p>
  </div>
);

// --- Edit Profile Modal ---
const EditProfileModal = ({ user, onClose, theme }) => {
  const [data, setData] = useState({ bio: user?.bio||'', location: user?.location||'', website: user?.website||'' });
  const [photoFile, setPhotoFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  
  // Initialize with current URLs
  const [photoPreview, setPhotoPreview] = useState(user?.photoURL || '');
  const [coverPreview, setCoverPreview] = useState(user?.coverURL || '');
  
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);

  const photoInputRef = useRef(null);
  const coverInputRef = useRef(null);

  const bgClass = theme === 'light' ? 'bg-white/80 border-white/20' : 'bg-zinc-900/80 border-white/10';
  const textClass = theme === 'light' ? 'text-black' : 'text-white';
  const inputClass = theme === 'light' ? 'bg-white/50 border-gray-200 text-black focus:ring-blue-500/30' : 'bg-black/30 border-white/10 text-white focus:ring-blue-500/30';

  const handlePhotoSelect = (e) => {
    const file = e.target.files[0];
    if (file) { 
        setPhotoFile(file); 
        setPhotoPreview(URL.createObjectURL(file)); 
    }
  };
  
  const handleCoverSelect = (e) => {
    const file = e.target.files[0];
    if (file) { 
        setCoverFile(file); 
        setCoverPreview(URL.createObjectURL(file)); 
    }
  };

  const save = async () => {
    setSaving(true);
    setProgress(0);
    try {
      let finalPhotoURL = user.photoURL;
      let finalCoverURL = user.coverURL;
      
      if (photoFile) {
        finalPhotoURL = await uploadToCloudinary(photoFile, (p) => setProgress(p / 2));
      }
      
      if (coverFile) {
         finalCoverURL = await uploadToCloudinary(coverFile, (p) => {
             const base = photoFile ? 50 : 0;
             setProgress(base + (p / (photoFile ? 2 : 1)));
         });
      }

      await updateDoc(doc(db, COLL.USERS, user.uid), { 
        bio: data.bio, location: data.location, website: data.website,
        photoURL: finalPhotoURL, coverURL: finalCoverURL
      });
      onClose();
    } catch (e) { alert("Error saving profile"); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
      <div className={`${bgClass} backdrop-blur-2xl w-full max-w-md rounded-3xl p-6 space-y-5 shadow-2xl relative border overflow-y-auto max-h-[90vh]`}>
        <div className={`flex justify-between items-center pb-2 border-b border-white/10`}><h2 className={`font-bold text-xl ${textClass}`}>Edit Profile</h2><button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors"><X className={textClass}/></button></div>
        
        {saving && (
           <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden mb-2">
              <div className="bg-blue-500 h-full transition-all duration-300 rounded-full" style={{width: `${progress}%`}}></div>
           </div>
        )}

        <div className="relative h-32 w-full rounded-2xl overflow-hidden bg-zinc-800/50 cursor-pointer group border border-white/5" onClick={()=>!saving && coverInputRef.current.click()}>
           <MediaWithLoader src={coverPreview} className="w-full h-full" fallbackChar={user.username} type="avatar" objectFit="cover" />
           <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"><Camera className="text-white drop-shadow-lg"/></div>
           <input type="file" ref={coverInputRef} onChange={handleCoverSelect} className="hidden" accept="image/*" />
        </div>
        <div className="-mt-16 ml-4 relative w-fit group cursor-pointer" onClick={()=>!saving && photoInputRef.current.click()}>
           <div className="relative w-24 h-24 rounded-full border-4 border-black/50 overflow-hidden bg-zinc-800 shadow-xl">
             <MediaWithLoader src={photoPreview} className="w-full h-full" fallbackChar={user.username} type="avatar" objectFit="cover"/>
             <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"><Camera className="text-white drop-shadow-lg"/></div>
           </div>
           <input type="file" ref={photoInputRef} onChange={handlePhotoSelect} className="hidden" accept="image/*" />
        </div>
        <input className={`w-full p-4 rounded-2xl outline-none border transition-all ${inputClass}`} value={data.bio} onChange={e=>setData({...data, bio:e.target.value})} placeholder="Bio"/>
        <input className={`w-full p-4 rounded-2xl outline-none border transition-all ${inputClass}`} value={data.location} onChange={e=>setData({...data, location:e.target.value})} placeholder="Location"/>
        <input className={`w-full p-4 rounded-2xl outline-none border transition-all ${inputClass}`} value={data.website} onChange={e=>setData({...data, website:e.target.value})} placeholder="Website"/>
        <button onClick={save} disabled={saving} className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl hover:bg-blue-500 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 shadow-lg shadow-blue-500/30">{saving ? `Uploading... ${progress}%` : 'Save Changes'}</button>
      </div>
    </div>
  );
};

// --- Quote Modal ---
const QuoteModal = ({ postToQuote, user, onClose, theme }) => {
  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const bgClass = theme === 'light' ? 'bg-white/90 text-gray-900' : 'bg-zinc-900/90 text-white';
  const borderClass = theme === 'light' ? 'border-gray-200' : 'border-white/10';

  const handleQuote = async () => {
    if (!content.trim() || isPosting) return;
    setIsPosting(true);
    try {
      await addDoc(collection(db, COLL.POSTS), {
        authorId: user.uid, authorName: user.fullName, authorHandle: user.handle, authorPhoto: user.photoURL, authorVerified: user.verified || false,
        content: content, isQuote: true,
        quotedPost: { id: postToQuote.id, authorName: postToQuote.authorName, authorHandle: postToQuote.authorHandle, authorPhoto: postToQuote.authorPhoto || "", content: postToQuote.content, image: postToQuote.image || null },
        createdAt: new Date().toISOString(), likesCount: 0, likedBy: [], repostCount: 0, commentCount: 0
      });
      await updateDoc(doc(db, COLL.POSTS, postToQuote.id), { repostCount: increment(1) });
      createNotification(postToQuote.authorId, 'quote', user, postToQuote.id, content);
      onClose();
    } catch(e) { alert("Failed to quote"); } finally { setIsPosting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className={`${bgClass} backdrop-blur-xl w-full max-w-lg rounded-3xl p-6 shadow-2xl border ${borderClass} animate-in zoom-in-95 duration-200`}>
        <div className="flex justify-between items-center mb-4"><h2 className="font-bold text-lg">Quote Post</h2><button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X/></button></div>
        <div className="flex gap-3 mb-4">
          <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 ring-2 ring-white/10"><MediaWithLoader src={user.photoURL} className="w-full h-full" fallbackChar={user.username} type="avatar"/></div>
          <textarea autoFocus value={content} onChange={e=>setContent(e.target.value)} className={`w-full bg-transparent outline-none text-lg resize-none placeholder-zinc-500`} placeholder="Add a comment..."/>
        </div>
        <div className={`rounded-2xl border border-white/5 bg-white/5 p-4 mb-4`}>
           <div className="flex items-center gap-2 mb-1">
             <div className="w-5 h-5 rounded-full overflow-hidden"><MediaWithLoader src={postToQuote.authorPhoto} className="w-full h-full" fallbackChar={postToQuote.authorName} type="avatar"/></div>
             <span className="font-bold text-sm">{postToQuote.authorName}</span><span className="text-zinc-500 text-xs">{postToQuote.authorHandle}</span>
           </div>
           <p className="text-sm line-clamp-3 opacity-80">{postToQuote.content}</p>
        </div>
        <div className="flex justify-end"><button onClick={handleQuote} disabled={!content.trim() || isPosting} className="bg-blue-600 text-white px-6 py-2 rounded-full font-bold active:scale-95 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50">{isPosting ? 'Posting...' : 'Post'}</button></div>
      </div>
    </div>
  );
};

// --- Tweet Component ---
const Tweet = ({ post, currentUser, onDelete, onComment, onRepostToggle, onQuote, isRepostedByMe, theme, onUserClick, allUsers }) => {
  const [isLiked, setIsLiked] = useState(false);
  const [showRepostMenu, setShowRepostMenu] = useState(false);
  const menuRef = useRef(null);
  const author = allUsers.find(u => u.id === post.authorId) || { fullName: post.authorName, handle: post.authorHandle, photoURL: post.authorPhoto, verified: post.authorVerified };

  const textClass = theme === 'light' ? 'text-gray-900' : 'text-zinc-100';
  const subTextClass = theme === 'light' ? 'text-gray-500' : 'text-zinc-400';
  const borderClass = theme === 'light' ? 'border-gray-100' : 'border-white/5';
  const hoverClass = theme === 'light' ? 'hover:bg-gray-50/80' : 'hover:bg-white/5';
  const menuBgClass = theme === 'light' ? 'bg-white/90 backdrop-blur-xl text-gray-900' : 'bg-zinc-900/90 backdrop-blur-xl text-white';
  
  const isVideo = (url) => url && (url.includes('.mp4') || url.includes('.webm') || url.includes('.mov') || url.includes('/video/') || url.includes('f_video'));

  useEffect(() => { setIsLiked(currentUser && post.likedBy?.includes(currentUser.uid)); }, [post, currentUser]);
  useEffect(() => {
    const handleClickOutside = (event) => { if (menuRef.current && !menuRef.current.contains(event.target)) setShowRepostMenu(false); };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLike = async (e) => {
    e.stopPropagation();
    if (!currentUser) return;
    const ref = doc(db, COLL.POSTS, post.id);
    if(isLiked) {
      setIsLiked(false); 
      await updateDoc(ref, { likedBy: arrayRemove(currentUser.uid), likesCount: increment(-1) });
    } else {
      setIsLiked(true);
      await updateDoc(ref, { likedBy: arrayUnion(currentUser.uid), likesCount: increment(1) });
      createNotification(post.authorId, 'like', currentUser, post.id, post.content);
    }
  };

  const isOwner = currentUser && post.authorId === currentUser.uid;
  if (!post.content && !post.image && !post.isRepost && !post.isQuote) return null;

  return (
    <div className={`border-b ${borderClass} p-4 ${hoverClass} cursor-pointer animate-in fade-in duration-500 transition-colors`}>
      <div className="flex gap-4">
        <div className="relative h-fit shrink-0 group" onClick={(e)=>{e.stopPropagation(); onUserClick(post.authorId)}}>
           <div className="w-12 h-12 rounded-full overflow-hidden border border-white/10 shadow-md group-hover:scale-105 transition-transform">
             <MediaWithLoader src={author.photoURL} className="w-full h-full" fallbackChar={author.fullName} type="avatar"/>
           </div>
           <OnlineBadge userId={post.authorId} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start">
             <div className="flex gap-1.5 items-center overflow-hidden" onClick={(e)=>{e.stopPropagation(); onUserClick(post.authorId)}}>
               <span className={`font-bold text-[16px] hover:underline truncate ${textClass}`}>{author.fullName}</span><VerifiedBadge isVerified={author.verified} /><span className={`${subTextClass} truncate text-[14px]`}>{author.handle}</span><span className={`${subTextClass} text-[14px]`}>·</span><span className={`${subTextClass} text-[14px]`}>{formatTime(post.createdAt)}</span>
             </div>
             {isOwner && <button onClick={(e)=>{e.stopPropagation(); onDelete(post.id)}} className="text-zinc-600 hover:text-red-500 p-2 hover:bg-red-500/10 rounded-full transition-colors"><Trash2 size={15}/></button>}
          </div>
          {post.isRepost && <div className={`text-[12px] ${subTextClass} flex items-center gap-1.5 my-1 font-medium`}><Repeat2 size={12}/> <span>Reposted from {post.originalAuthor}</span></div>}
          {post.content && <p className={`mt-1 text-[16px] leading-relaxed whitespace-pre-wrap ${textClass} font-normal tracking-wide`}>{post.content}</p>}
          {post.isQuote && post.quotedPost && (
             <div className={`mt-3 rounded-2xl border ${borderClass} p-4 ${theme==='light'?'bg-gray-50':'bg-white/5'} hover:bg-opacity-80 transition-all`} onClick={(e)=>{e.stopPropagation();}}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full overflow-hidden"><MediaWithLoader src={post.quotedPost.authorPhoto} className="w-full h-full" fallbackChar={post.quotedPost.authorName} type="avatar"/></div>
                  <span className={`font-bold text-sm ${textClass}`}>{post.quotedPost.authorName}</span><span className={`text-xs ${subTextClass}`}>{post.quotedPost.authorHandle}</span>
                </div>
                <p className={`text-sm ${textClass} mb-2`}>{post.quotedPost.content}</p>
                {post.quotedPost.image && (
                  <div className="mt-2 w-full rounded-xl overflow-hidden bg-black/50 border border-white/5">
                    <MediaWithLoader src={post.quotedPost.image} className="w-full h-auto max-h-[400px]" type={isVideo(post.quotedPost.image) ? 'video' : 'image'} objectFit="contain" muted/>
                  </div>
                )}
             </div>
          )}
          {post.image && (
            <div className={`mt-3 rounded-2xl overflow-hidden border ${borderClass} bg-black/50 shadow-lg`}>
              <MediaWithLoader src={post.image} className="w-full max-h-[600px] object-contain" type={isVideo(post.image) ? 'video' : 'image'} />
            </div>
          )}
          <div className={`flex justify-between mt-4 max-w-md ${subTextClass} text-[13px]`}>
            <button onClick={(e)=>{e.stopPropagation(); onComment(post)}} className="flex items-center gap-2 hover:text-blue-400 group transition-colors"><div className="p-2 group-hover:bg-blue-500/10 rounded-full transition-colors"><MessageCircle size={18}/></div> <span>{formatCount(post.commentCount||0)}</span></button>
            <div className="relative" ref={menuRef}>
                <button 
                  onClick={(e)=>{e.stopPropagation(); setShowRepostMenu(!showRepostMenu)}} 
                  className={`flex items-center gap-2 group transition-colors ${isRepostedByMe ? 'text-green-500' : 'hover:text-green-500'}`}
                >
                  <div className="p-2 group-hover:bg-green-500/10 rounded-full transition-colors"><Repeat2 size={18} strokeWidth={isRepostedByMe ? 3 : 2} /></div> <span>{formatCount(post.repostCount||0)}</span>
                </button>
                {showRepostMenu && (<div className={`absolute bottom-8 -left-2 w-32 ${menuBgClass} border ${borderClass} rounded-2xl shadow-xl z-50 overflow-hidden flex flex-col`}>
                     <button onClick={(e)=>{e.stopPropagation(); onRepostToggle(post); setShowRepostMenu(false);}} className={`p-3 text-left hover:bg-white/10 font-bold ${textClass}`}>
                       {isRepostedByMe ? 'Undo Repost' : 'Repost'}
                     </button>
                     <button onClick={(e)=>{e.stopPropagation(); onQuote(post); setShowRepostMenu(false);}} className={`p-3 text-left hover:bg-white/10 ${textClass}`}>Quote Post</button>
                  </div>)}
            </div>
            <button onClick={handleLike} className={`flex items-center gap-2 group transition-colors ${isLiked?'text-pink-600':'hover:text-pink-600'}`}><div className="p-2 group-hover:bg-pink-500/10 rounded-full transition-colors"><Heart size={18} fill={isLiked?"currentColor":"none"} className={`transition-transform duration-200 ${isLiked ? 'scale-110' : 'group-active:scale-75'}`}/></div><span>{formatCount(post.likesCount||0)}</span></button>
            <button className="flex items-center gap-2 hover:text-blue-400 group transition-colors"><div className="p-2 group-hover:bg-blue-500/10 rounded-full transition-colors"><Share size={18}/></div></button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Settings View ---
const SettingsView = ({ theme, setTheme, onLogout }) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const textClass = theme === 'light' ? 'text-gray-900' : 'text-white';
  const cardClass = theme === 'light' ? 'bg-white border-gray-200' : 'bg-zinc-900/50 backdrop-blur-xl border-white/10';
  
  return (
    <div className="p-6 max-w-2xl mx-auto animate-in fade-in">
       <h1 className={`text-2xl font-bold mb-6 ${textClass}`}>Settings</h1>
       <div className={`rounded-3xl border ${cardClass} overflow-hidden mb-6 shadow-xl`}>
          <div className="p-5 border-b border-white/5"><h3 className={`font-bold ${textClass}`}>Appearance</h3></div>
          <div className="p-5 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors" onClick={()=>setTheme(theme==='dark'?'light':'dark')}>
             <div className="flex items-center gap-3">{theme==='dark' ? <Moon className="text-purple-500"/> : <Sun className="text-orange-500"/>}<span className={textClass}>{theme==='dark' ? 'Dark Mode' : 'Light Mode'}</span></div>
             <div className={`w-12 h-7 rounded-full relative transition-colors ${theme==='dark'?'bg-blue-600':'bg-zinc-300'}`}><div className={`w-5 h-5 bg-white rounded-full absolute top-1 shadow-sm transition-all ${theme==='dark'?'left-6':'left-1'}`}></div></div>
          </div>
       </div>
       <div className={`rounded-3xl border ${cardClass} overflow-hidden shadow-xl`}>
          <div className="p-5 border-b border-white/5"><h3 className={`font-bold ${textClass}`}>Account</h3></div>
          {!showConfirm ? <button className={`w-full p-5 text-left text-red-500 font-bold flex items-center gap-3 hover:bg-red-500/10 transition-colors`} onClick={()=>setShowConfirm(true)}><LogOut size={20}/> Log out</button>
          : <div className="p-5 bg-red-500/10 animate-in fade-in"><p className="text-red-500 mb-4 font-bold">Are you sure you want to log out?</p><div className="flex gap-3"><button onClick={onLogout} className="bg-red-500 text-white px-6 py-2.5 rounded-xl font-bold hover:scale-105 transition-transform">Yes, Logout</button><button onClick={()=>setShowConfirm(false)} className={`px-6 py-2.5 rounded-xl font-bold ${theme==='light'?'bg-gray-200 text-black':'bg-white/10 text-white hover:bg-white/20'} transition-all`}>Cancel</button></div></div>}
       </div>
    </div>
  );
};

const AuthScreen = ({ theme }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ email: '', password: '', fullName: '', username: '', dob: '', gender: 'male' });
  
  const handleChange = (e) => { 
      const { name, value } = e.target; 
      if (name === 'username') setForm(prev => ({ ...prev, username: value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() })); 
      else setForm(prev => ({ ...prev, [name]: value })); 
  };

  const handleAuth = async (e) => {
    e.preventDefault(); 
    setLoading(true); 
    setError('');
    
    try {
      if (isLogin) {
          await signInWithEmailAndPassword(auth, form.email, form.password);
      } else {
        if (form.password.length < 6) throw new Error("Password min 6 chars");
        
        const handleRef = doc(db, COLL.USERNAMES, form.username);
        const handleSnap = await getDoc(handleRef);
        if (handleSnap.exists()) throw new Error(`@${form.username} is already taken.`);
        
        const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
        const uid = cred.user.uid;
        
        let avatarUrl = form.gender === 'female' 
           ? `https://api.dicebear.com/7.x/personal/svg?seed=${form.username}` 
           : `https://api.dicebear.com/7.x/avataaars/svg?seed=${form.username}&clothing=blazerAndShirt&top=shortHair`;
        
        await setDoc(doc(db, COLL.USERS, uid), { 
            uid, 
            fullName: form.fullName, 
            handle: `@${form.username}`, 
            username: form.username, 
            email: form.email, 
            dob: form.dob, 
            gender: form.gender, 
            photoURL: avatarUrl, 
            bio: "Just joined TruthSpace!", 
            verified: false, 
            followersCount: 0, 
            followingCount: 0, 
            createdAt: new Date().toISOString() 
        });
        
        await setDoc(handleRef, { uid }); 
        await updateProfile(cred.user, { displayName: form.fullName });
      }
    } catch (err) { 
        setError(err.message.replace('Firebase: ', '')); 
    } finally { 
        setLoading(false); 
    }
  };

  return (
    <div className={`flex min-h-screen items-center justify-center p-4 relative overflow-hidden bg-[url('https://grainy-gradients.vercel.app/noise.svg')] ${theme==='light'?'bg-gray-100 text-black':'bg-[#050505] text-white'}`}>
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-600/20 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-md space-y-8 animate-in zoom-in-95 duration-500 p-8 border rounded-[32px] shadow-2xl border-white/10 bg-white/5 backdrop-blur-3xl relative z-10 ring-1 ring-white/10">
        <div className="text-center">
            <div className="mx-auto w-fit mb-6 drop-shadow-xl"><TruthSpaceLogo size={60}/></div>
            <h1 className="text-4xl font-bold tracking-tight mb-2 bg-gradient-to-b from-white to-white/70 bg-clip-text text-transparent">{isLogin ? 'Welcome Back' : 'Join TruthSpace'}</h1>
            <p className="text-zinc-400">Enter the truth.</p>
        </div>
        
        {error && (
            <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl text-red-400 flex gap-3 items-center text-sm font-medium">
                <X size={18}/> {error}
            </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          {!isLogin && (<>
              <input name="fullName" placeholder="Full Name" onChange={handleChange} className="w-full bg-black/20 p-4 rounded-2xl border border-white/10 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-zinc-600" required />
              <div className="relative">
                  <span className="absolute left-4 top-4 text-zinc-500 font-bold">@</span>
                  <input name="username" value={form.username} placeholder="username" onChange={handleChange} className="w-full bg-black/20 p-4 pl-9 rounded-2xl border border-white/10 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-zinc-600" required />
              </div>
              <div className="flex gap-4">
                  <label className={`flex-1 p-3 rounded-2xl border cursor-pointer transition-all ${form.gender==='male'?'bg-blue-500/20 border-blue-500 text-blue-400':'bg-black/20 border-white/10 text-zinc-500 hover:bg-white/5'}`}>
                      <input type="radio" name="gender" value="male" checked={form.gender==='male'} onChange={handleChange} className="hidden"/>
                      <div className="text-center font-bold">Male</div>
                  </label>
                  <label className={`flex-1 p-3 rounded-2xl border cursor-pointer transition-all ${form.gender==='female'?'bg-pink-500/20 border-pink-500 text-pink-400':'bg-black/20 border-white/10 text-zinc-500 hover:bg-white/5'}`}>
                      <input type="radio" name="gender" value="female" checked={form.gender==='female'} onChange={handleChange} className="hidden"/>
                      <div className="text-center font-bold">Female</div>
                  </label>
              </div>
              <div className="space-y-1">
                 <label className="text-xs text-zinc-500 font-bold ml-1 flex items-center gap-1 uppercase tracking-wider"><Calendar size={12}/> Date of Birth (DOB)</label>
                 <input name="dob" type="date" onChange={handleChange} className="w-full bg-black/20 p-4 rounded-2xl border border-white/10 text-zinc-400 outline-none focus:border-blue-500/50 transition-all" required />
              </div>
          </>)}
          <input name="email" type="email" placeholder="Email" onChange={handleChange} className="w-full bg-black/20 p-4 rounded-2xl border border-white/10 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-zinc-600" required />
          <input name="password" type="password" placeholder="Password" onChange={handleChange} className="w-full bg-black/20 p-4 rounded-2xl border border-white/10 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-zinc-600" required />
          <button disabled={loading} className="w-full bg-white text-black font-bold py-4 rounded-2xl mt-6 hover:scale-[1.02] active:scale-95 transition-all shadow-xl shadow-white/10 disabled:opacity-50 disabled:scale-100">
              {loading ? <Loader2 className="animate-spin mx-auto"/> : (isLogin ? 'Enter' : 'Create Account')}
          </button>
        </form>
        
        <div className="pt-6 border-t border-white/10 mt-6 text-center">
            <p className="text-zinc-500 text-sm mb-3">{isLogin ? "Don't have an account?" : "Already have an account?"}</p>
            <button 
                className="text-white/80 font-bold hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-6 py-2.5 rounded-full border border-white/10 text-sm" 
                onClick={()=>setIsLogin(!isLogin)}
            >
                {isLogin ? "Create an account" : "Log in"}
            </button>
        </div>
      </div>
    </div>
  );
};

// --- UPDATED AI Assistant Modal (Rich UI) ---
const AIAssistantModal = ({ initialText, onApply, onClose, theme }) => {
  const [mode, setMode] = useState('fix');
  const [input, setInput] = useState(initialText || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const bgClass = theme === 'light' ? 'bg-white/90 text-gray-900 border-gray-200' : 'bg-zinc-900/90 text-white border-white/10';
  const inputClass = theme === 'light' ? 'bg-gray-50 border-gray-200 text-black' : 'bg-black/30 border-white/10 text-white';
  const cardClass = theme === 'light' ? 'bg-gray-50 border-gray-200 hover:border-blue-400 hover:bg-blue-50' : 'bg-white/5 border-white/10 hover:border-blue-500 hover:bg-blue-500/10';

  const modes = [
    { id: 'fix', label: 'Fix Grammar', icon: CheckCircle2, prompt: "Fix grammar and improve flow. Provide 3 distinct versions: Professional, Casual, and Punchy. Return ONLY the text of the 3 versions separated by '|||'. Do not include labels like 'Option 1'." },
    { id: 'ideas', label: 'Ideas', icon: Lightbulb, prompt: "Generate 3 creative social media post ideas based on this topic. Return ONLY the text of the 3 ideas separated by '|||'. Do not include labels." },
    { id: 'title', label: 'Titles', icon: Type, prompt: "Generate 3 catchy headlines or hooks for this text. Return ONLY the text of the 3 headlines separated by '|||'. Do not include labels." },
  ];

  const handleAI = async () => {
    setLoading(true);
    setResults([]);
    const selectedMode = modes.find(m => m.id === mode);
    const prompt = `${selectedMode.prompt} Input: "${input}"`;
    
    try {
      const response = await callGemini(prompt);
      if (response) {
        const options = response.split('|||')
          .map(s => s.trim().replace(/^\s*[\*\-]?\s*\d+[\)\.]?\s*(\*\*)?.*(\*\*)?[\-\:]?\s*/, ''))
          .filter(s => s.length > 0);
        setResults(options.slice(0, 3));
      }
    } catch (e) {
      setResults(["Error generating content. Please try again."]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
      <div className={`${bgClass} backdrop-blur-xl border w-full max-w-lg rounded-3xl p-6 shadow-2xl flex flex-col max-h-[90vh]`}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold flex items-center gap-2 bg-gradient-to-r from-purple-400 to-blue-500 bg-clip-text text-transparent">
            <Sparkles className="text-purple-500" /> AI Assistant
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={20}/></button>
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
           {modes.map(m => (
             <button 
               key={m.id} 
               onClick={() => {setMode(m.id); setResults([]);}} 
               className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold whitespace-nowrap transition-all ${mode===m.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' : (theme==='light'?'bg-gray-100 text-gray-600 hover:bg-gray-200':'bg-white/5 text-zinc-400 hover:bg-white/10')}`}
             >
               <m.icon size={16}/> {m.label}
             </button>
           ))}
        </div>

        <div className="relative mb-4">
          <textarea 
            value={input} 
            onChange={(e) => setInput(e.target.value)} 
            className={`w-full rounded-2xl p-4 min-h-[100px] outline-none border resize-none transition-all focus:ring-2 focus:ring-blue-500/50 ${inputClass}`} 
            placeholder="Type your draft or topic here..." 
          />
          <button 
            onClick={handleAI} 
            disabled={!input.trim() || loading}
            className="absolute bottom-3 right-3 bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
          >
            {loading ? <Loader2 className="animate-spin" size={20}/> : <Wand2 size={20}/>}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {results.length > 0 ? (
            results.map((res, idx) => (
              <div 
                key={idx} 
                onClick={() => onApply(res)}
                className={`relative p-5 rounded-2xl border cursor-pointer group transition-all duration-300 ${cardClass} animate-in slide-in-from-bottom-4 fade-in fill-mode-forwards`}
                style={{animationDelay: `${idx * 100}ms`}}
              >
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-600 text-white text-xs px-2 py-1 rounded-full font-bold shadow-lg pointer-events-none">
                   Use This <ArrowRight size={10} className="inline ml-1"/>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap pr-4 font-medium">{res}</p>
              </div>
            ))
          ) : (
            !loading && <div className="text-center py-10 opacity-30 flex flex-col items-center gap-2"><Sparkles size={40} strokeWidth={1}/> <p>AI magic waiting to happen...</p></div>
          )}
        </div>

        {results.length > 0 && (
          <div className="pt-4 mt-2 border-t border-dashed border-zinc-700/50 flex justify-center">
             <button onClick={handleAI} className="flex items-center gap-2 text-sm font-bold text-zinc-500 hover:text-blue-400 transition-colors">
               <RefreshCw size={16}/> Regenerate Results
             </button>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Comments Modal ---
const CommentsModal = ({ post, user, onClose, theme }) => {
  const [comments, setComments] = useState([]);
  const [txt, setTxt] = useState('');
  const [isSending, setIsSending] = useState(false);
  const bgClass = theme === 'light' ? 'bg-white/90 text-black' : 'bg-zinc-900/90 text-white';
  const borderClass = theme === 'light' ? 'border-gray-200' : 'border-white/10';
  const inputBgClass = theme === 'light' ? 'bg-gray-100' : 'bg-white/5';
  const subtleText = theme === 'light' ? 'text-gray-500' : 'text-zinc-500';

  useEffect(() => {
    const q = query(collection(db, COLL.COMMENTS), where("postId", "==", post.id));
    const unsub = onSnapshot(q, (snap) => {
      setComments(snap.docs.map(d => ({id: d.id, ...d.data()})).sort((a,b) => a.createdAt - b.createdAt));
    });
    return () => unsub();
  }, [post.id]);

  const sendComment = async () => {
    if(!txt.trim() || isSending) return;
    setIsSending(true);
    try {
      await addDoc(collection(db, COLL.COMMENTS), {
        postId: post.id, authorId: user.uid, authorName: user.fullName, authorHandle: user.handle, authorPhoto: user.photoURL, authorVerified: user.verified || false, text: txt, createdAt: Date.now()
      });
      await updateDoc(doc(db, COLL.POSTS, post.id), { commentCount: increment(1) });
      createNotification(post.authorId, 'comment', user, post.id, txt); 
      setTxt('');
    } catch(e) { } finally { setIsSending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4 animate-in fade-in duration-200">
      <div className={`${bgClass} backdrop-blur-xl w-full sm:max-w-lg h-[85vh] sm:h-[80vh] rounded-t-[32px] sm:rounded-3xl flex flex-col shadow-2xl border-t sm:border ${borderClass} overflow-hidden transition-transform animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-4 duration-500`}>
        <div className={`p-4 border-b ${borderClass} flex justify-between items-center`}><h2 className="font-bold text-lg">Replies</h2><button onClick={onClose} className={`p-2 rounded-full ${theme==='light'?'hover:bg-gray-100':'hover:bg-white/10'}`}><X/></button></div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex gap-3 mb-6 relative">
             <div className={`absolute left-[19px] top-10 bottom-[-20px] w-0.5 ${theme==='light'?'bg-gray-200':'bg-white/10'}`}></div>
             <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 z-10"><MediaWithLoader src={post.authorPhoto} className="w-full h-full" fallbackChar={post.authorName} type="avatar"/></div>
             <div><div className="font-bold text-sm flex items-center gap-1">{post.authorName} <span className={`font-normal ${subtleText} ml-1`}>{post.authorHandle}</span></div><p className="text-sm mt-1">{post.content}</p></div>
          </div>
          <div className="space-y-4">
             {comments.map(c => (
               <div key={c.id} className="flex gap-3 animate-in fade-in slide-in-from-bottom-2">
                  <div className="w-9 h-9 rounded-full overflow-hidden shrink-0"><MediaWithLoader src={c.authorPhoto} className="w-full h-full" fallbackChar={c.authorName} type="avatar"/></div>
                  <div className="flex-1">
                     <div className="flex items-center gap-1 mb-0.5"><span className="font-bold text-sm">{c.authorName}</span><VerifiedBadge isVerified={c.authorVerified} /><span className={`text-xs ${subtleText}`}>{c.authorHandle}</span><span className={`text-xs ${subtleText}`}>· {new Date(c.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span></div>
                     <p className="text-sm">{c.text}</p>
                  </div>
               </div>
             ))}
             {comments.length === 0 && <div className={`text-center ${subtleText} py-8`}>No replies yet. Start the conversation!</div>}
          </div>
        </div>
        <div className={`p-3 border-t ${borderClass} flex items-center gap-2 ${bgClass}`}>
           <div className="w-8 h-8 rounded-full overflow-hidden shrink-0"><MediaWithLoader src={user.photoURL} className="w-full h-full" fallbackChar={user.username} type="avatar"/></div>
           <div className={`flex-1 ${inputBgClass} rounded-full px-4 py-2.5 flex items-center`}><input className={`bg-transparent outline-none w-full text-sm ${theme==='light'?'text-black':'text-white'}`} placeholder="Post your reply" value={txt} onChange={e=>setTxt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendComment()}/></div>
           <button onClick={sendComment} disabled={!txt.trim() || isSending} className="bg-blue-600 p-2.5 rounded-full text-white disabled:opacity-50 hover:bg-blue-500 active:scale-95 transition-all shadow-lg shadow-blue-500/30">{isSending ? <Loader2 className="animate-spin" size={18}/> : <Send size={18}/>}</button>
        </div>
      </div>
    </div>
  );
};

// --- ENHANCED Notifications View (Uses RTDB + New UI) ---
const NotificationsView = ({ user, theme }) => {
   const [notifs, setNotifs] = useState([]);
   const [loading, setLoading] = useState(true);
   const textClass = theme === 'light' ? 'text-gray-900' : 'text-white';
   const subtleText = theme === 'light' ? 'text-gray-500' : 'text-zinc-500';
   const borderClass = theme === 'light' ? 'border-gray-200' : 'border-zinc-800';
   
   useEffect(() => {
     if(!user) return;
     const notifRef = ref(rtdb, `notifications/${user.uid}`);
     const unsub = onValue(notifRef, (snapshot) => {
        const data = snapshot.val();
        const loadedNotifs = [];
        const unreadIds = [];

        if (data) {
          Object.entries(data).forEach(([key, val]) => {
             loadedNotifs.push({ id: key, ...val });
             if (val.read === false) unreadIds.push(key);
          });
        }
        
        loadedNotifs.sort((a, b) => {
            const timeA = typeof a.createdAt === 'number' ? a.createdAt : 0;
            const timeB = typeof b.createdAt === 'number' ? b.createdAt : 0;
            return timeB - timeA;
        });

        setNotifs(loadedNotifs);
        setLoading(false);

        // Auto-mark as read
        if (unreadIds.length > 0) {
           const updates = {};
           unreadIds.forEach(id => {
              updates[`notifications/${user.uid}/${id}/read`] = true;
           });
           update(ref(rtdb), updates);
        }
     });

     return () => unsub();
   }, [user]);

   return (
      <div className="max-w-2xl mx-auto animate-in fade-in pb-20">
         <div className={`p-4 border-b ${borderClass} sticky top-0 backdrop-blur-md z-10 flex justify-between items-center ${theme==='light'?'bg-white/80':'bg-black/80'}`}>
           <h1 className={`text-xl font-bold ${textClass}`}>Notifications</h1>
           <div className={`p-2 rounded-full ${theme==='light'?'bg-gray-100':'bg-zinc-800'}`}><Bell size={20} className={textClass}/></div>
         </div>
         {loading ? <div className="p-10 flex justify-center"><Loader2 className="animate-spin"/></div> : (
            notifs.length === 0 ? 
            <div className={`text-center py-20 ${subtleText} flex flex-col items-center`}>
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${theme==='light'?'bg-gray-100':'bg-zinc-800'}`}><Bell size={32} className="opacity-50"/></div>
              <p className="font-bold text-lg mb-1">Nothing here yet</p>
              <p className="text-sm">When you get likes, comments or follows, they'll show up here.</p>
            </div> :
            <div className="flex flex-col">
               {notifs.map((n, i) => (
                 <div key={n.id} className={`p-4 border-b ${borderClass} flex gap-4 transition-all duration-300 animate-in slide-in-from-bottom-2 ${!n.read ? (theme==='light' ? 'bg-blue-50' : 'bg-blue-900/20') : (theme==='light'?'hover:bg-gray-50':'hover:bg-zinc-900/30')}`} style={{animationDelay: `${i * 50}ms`}}>
                    <div className="pt-1 shrink-0 relative">
                      {!n.read && <div className="absolute -top-1 -left-1 w-2.5 h-2.5 bg-blue-500 rounded-full z-10 border-2 border-white dark:border-black shadow-sm"></div>}
                      
                      {n.type === 'like' && <div className="w-8 h-8 rounded-full bg-pink-500/10 flex items-center justify-center text-pink-500"><Heart fill="currentColor" size={16}/></div>}
                      {n.type === 'comment' && <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500"><MessageCircle fill="currentColor" size={16}/></div>}
                      {n.type === 'follow' && <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-500"><UserPlus fill="currentColor" size={16}/></div>}
                      {n.type === 'quote' && <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center text-green-500"><Repeat2 size={16}/></div>}
                      {n.type === 'new_post' && <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500"><Zap fill="currentColor" size={16}/></div>}
                    </div>
                    <div className="flex-1">
                       <div className="flex items-center gap-2 mb-1">
                          <div className="w-6 h-6 rounded-full overflow-hidden border border-zinc-700/20"><MediaWithLoader src={n.senderPhoto} className="w-full h-full" fallbackChar={n.senderName} type="avatar"/></div>
                          <div className={`text-sm ${textClass}`}>
                             <span className="font-bold hover:underline cursor-pointer">{n.senderName}</span>
                             <span className={`ml-1 ${subtleText}`}>
                                {n.type === 'like' && 'liked your post'}
                                {n.type === 'comment' && 'replied to your post'}
                                {n.type === 'follow' && 'followed you'}
                                {n.type === 'quote' && 'quoted your post'}
                                {n.type === 'new_post' && 'posted something new'}
                             </span>
                          </div>
                       </div>
                       {n.postSnippet && (
                         <div className={`text-sm mt-1 p-2 rounded-lg ${subtleText} ${theme==='light'?'bg-gray-100':'bg-zinc-800/50'}`}>
                           "{n.postSnippet}"
                         </div>
                       )}
                       <div className={`text-xs mt-2 ${subtleText}`}>{formatTime(n.createdAt)}</div>
                    </div>
                 </div>
               ))}
            </div>
         )}
      </div>
   );
};

// --- Main App ---
export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState('dark');
  
  const [view, setView] = useState('home');
  const [posts, setPosts] = useState([]);
  const [users, setUsers] = useState([]);
  const [activePost, setActivePost] = useState(null);
  const [quotePost, setQuotePost] = useState(null);
  
  const [postTxt, setPostTxt] = useState('');
  const [file, setFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const fileInputRef = useRef(null);
  const [showAI, setShowAI] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [following, setFollowing] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [viewProfileId, setViewProfileId] = useState(null);
  const [isPosting, setIsPosting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); 
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  
  const [aiSortedIds, setAiSortedIds] = useState([]);
  const [isAnalyzingFeed, setIsAnalyzingFeed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const bgClass = theme === 'light' ? 'bg-white' : 'bg-[#000000]';
  const textClass = theme === 'light' ? 'text-gray-900' : 'text-white';
  const borderClass = theme === 'light' ? 'border-gray-200' : 'border-zinc-800';

  const swipeHandlers = useSwipe(() => { if (view !== 'home') setView('home'); });

  // NAVIGATION HANDLER - REFRESH TO TOP
  const handleNavClick = (targetView) => {
    if (view === targetView) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setView(targetView);
      window.scrollTo(0, 0);
    }
  };

  useEffect(() => {
    const initAuth = async () => { 
        try {
            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                await signInWithCustomToken(auth, __initial_auth_token); 
            }
        } catch(e) {
            console.warn("Auth token check failed (dev mode likely).");
        }
    };
    initAuth();

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        onSnapshot(doc(db, COLL.USERS, u.uid), (doc) => { if(doc.exists()) setProfile(doc.data()); });
        onSnapshot(query(collection(db, COLL.POSTS)), (snap) => {
           const fetchedPosts = snap.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
           setPosts(fetchedPosts);
        });
        onSnapshot(collection(db, COLL.USERS), (snap) => setUsers(snap.docs.map(d=>({id:d.id, ...d.data()}))));
        onSnapshot(query(collection(db, COLL.FOLLOWS), where("followerId", "==", u.uid)), (snap) => setFollowing(snap.docs.map(d=>d.data().targetId)));
        
        // RTDB Presence
        const userStatusRef = ref(rtdb, `/status/${u.uid}`);
        onValue(ref(rtdb, '.info/connected'), (snap) => { if(snap.val()===true) { set(userStatusRef, { state: 'online', last_changed: rtdbTimestamp() }); onDisconnect(userStatusRef).set({ state: 'offline', last_changed: rtdbTimestamp() }); } });

        // RTDB Unread Count Listener
        const notifRef = ref(rtdb, `notifications/${u.uid}`);
        onValue(notifRef, (snapshot) => {
           const data = snapshot.val();
           let count = 0;
           if(data) {
              Object.values(data).forEach(n => {
                  if (n.read === false) count++;
              });
           }
           setUnreadCount(count);
        });
      }
      setLoading(false);
    });
    return () => unsubAuth();
  }, []);

  // AUTOMATIC AI FEED ANALYSIS
  useEffect(() => {
     if (posts.length > 0 && !isAnalyzingFeed) {
        analyzeFeedWithAI();
     }
  }, [posts]); 

  const analyzeFeedWithAI = async () => {
    setIsAnalyzingFeed(true);
    const recentPosts = posts.slice(0, 40).map(p => ({ 
      id: p.id, 
      text: p.content ? p.content.substring(0, 100) : "Media only", 
      hasImage: !!p.image, 
      likes: p.likesCount || 0,
      comments: p.commentCount || 0,
      verified: p.authorVerified
    }));
    
    const prompt = `Act as a social media feed algorithm. Sort these posts to create the most engaging, viral, and safe feed order.
    
    Rules:
    1. Boost posts with images (hasImage: true).
    2. Boost posts from verified authors (verified: true).
    3. Boost positive/inspiring/question-based text.
    4. Demote spam or very short nonsense text.
    5. Return ONLY a valid JSON array of strings (Post IDs) in the optimal order.

    Posts Data: ${JSON.stringify(recentPosts)}`;

    try {
       const response = await callGemini(prompt);
       if (response) {
         const cleanedResponse = response.replace(/```json/g, '').replace(/```/g, '').trim();
         const sortedIds = JSON.parse(cleanedResponse);
         if (Array.isArray(sortedIds) && sortedIds.length > 0) {
           setAiSortedIds(sortedIds);
         }
       }
    } catch (e) { } finally { 
      setIsAnalyzingFeed(false); 
    }
  };

  const getFeedPosts = () => {
    if (view !== 'home') return posts;
    if (aiSortedIds.length > 0) {
       const postsMap = new Map(posts.map(p => [p.id, p]));
       const aiPosts = aiSortedIds.map(id => postsMap.get(id)).filter(Boolean);
       const remainingPosts = posts.filter(p => !aiSortedIds.includes(p.id));
       return [...aiPosts, ...remainingPosts];
    }
    return posts;
  };

  // Pull to refresh hook usage
  const { refreshing, pulling } = usePullToRefresh(async () => {
     await analyzeFeedWithAI();
  });

  const feedPosts = getFeedPosts();
  const handleFileSelect = (e) => { const selected = e.target.files[0]; if (selected) { setFile(selected); setFilePreview(URL.createObjectURL(selected)); } };

  const createPost = async () => {
    if((!postTxt.trim() && !file) || isPosting) return;
    setIsPosting(true);
    setUploadProgress(0);

    let imageUrl = null; 
    
    if (file) {
      try {
        imageUrl = await uploadToCloudinary(file, (percent) => {
          setUploadProgress(percent);
        });
        if (!imageUrl) { 
          alert("Upload failed, please try again.");
          setIsPosting(false); 
          return; 
        }
      } catch (err) {
        alert("Error uploading media: " + err.message);
        setIsPosting(false);
        return;
      }
    }

    try {
      const newPostRef = await addDoc(collection(db, COLL.POSTS), {
        authorId: user.uid, authorName: profile.fullName, authorHandle: profile.handle, authorPhoto: profile.photoURL, authorVerified: profile.verified || false,
        content: postTxt, image: imageUrl, createdAt: new Date().toISOString(), likesCount: 0, likedBy: [], repostCount: 0, commentCount: 0
      });
      
      await notifyFollowersOfNewPost(profile, newPostRef.id, postTxt);

      setPostTxt(''); setFile(null); setFilePreview(null); setUploadProgress(0);
    } catch(e) { alert("Error posting to database."); } finally { setIsPosting(false); }
  };

  const deletePost = async (id) => { if(confirm("Delete?")) await deleteDoc(doc(db, COLL.POSTS, id)); };

  const handleToggleRepost = async (post) => {
    const rootId = post.isRepost ? post.originalPostId : post.id;
    const repostId = `${user.uid}_repost_${rootId}`;
    const repostRef = doc(db, COLL.POSTS, repostId);
    const repostSnap = await getDoc(repostRef);
    if (repostSnap.exists()) {
      await deleteDoc(repostRef);
      await updateDoc(doc(db, COLL.POSTS, rootId), { repostCount: increment(-1) });
    } else {
      await updateDoc(doc(db, COLL.POSTS, rootId), { repostCount: increment(1) });
      await setDoc(repostRef, {
        authorId: user.uid, authorName: profile.fullName, authorHandle: profile.handle, authorPhoto: profile.photoURL, authorVerified: profile.verified || false,
        content: post.content, image: post.image, isRepost: true, originalPostId: rootId, originalAuthor: post.isRepost ? post.originalAuthor : post.authorHandle,
        createdAt: new Date().toISOString(), likesCount: 0, likedBy: []
      });
      createNotification(post.authorId, 'quote', profile, rootId, post.content); 
    }
  };

  const toggleFollow = async (targetId) => {
    const followId = `${user.uid}_${targetId}`;
    const isFollowing = following.includes(targetId);
    if(isFollowing) {
      await deleteDoc(doc(db, COLL.FOLLOWS, followId));
      await updateDoc(doc(db, COLL.USERS, targetId), { followersCount: increment(-1) });
      await updateDoc(doc(db, COLL.USERS, user.uid), { followingCount: increment(-1) });
    } else {
      await setDoc(doc(db, COLL.FOLLOWS, followId), { followerId: user.uid, targetId });
      await updateDoc(doc(db, COLL.USERS, targetId), { followersCount: increment(1) });
      await updateDoc(doc(db, COLL.USERS, user.uid), { followingCount: increment(1) });
      createNotification(targetId, 'follow', profile); 
    }
  };

  const filteredPosts = posts.filter(p => p.content.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredUsers = users.filter(u => u.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || u.handle.toLowerCase().includes(searchTerm.toLowerCase()));

  if(loading) return <Loading theme={theme}/>;
  if(!user || !profile) return <AuthScreen theme={theme} />;

  const renderProfile = () => {
    const pid = viewProfileId || user.uid;
    const pUser = users.find(u => u.id === pid);
    if(!pUser) return <div className="p-10 text-center">User not found</div>;
    const isMe = pid === user.uid;
    const userPosts = posts.filter(p => p.authorId === pid);

    return (
       <div className="animate-in fade-in duration-500 pb-20">
          <div className={`sticky top-0 backdrop-blur-xl z-20 px-4 py-3 border-b ${borderClass} flex items-center gap-6 ${theme==='light'?'bg-white/80':'bg-black/80'}`}>
             <button onClick={()=>handleNavClick('home')} className={`p-2 rounded-full transition-colors ${theme==='light'?'hover:bg-gray-100':'hover:bg-zinc-800'}`}><ChevronLeft className={textClass}/></button>
             <div><div className={`font-bold text-lg flex items-center ${textClass}`}>{pUser.fullName} <VerifiedBadge isVerified={pUser.verified} /></div><div className="text-xs text-zinc-500">{formatCount(userPosts.length)} posts</div></div>
          </div>
          <div className="h-48 relative group overflow-hidden bg-zinc-800">
             <MediaWithLoader src={pUser.coverURL} className="w-full h-full" fallbackChar={pUser.username} type="image" objectFit="cover" />
             <div className="absolute inset-0 bg-black/20"></div>
          </div>
          <div className="px-4 relative mb-6">
             <div className="-mt-20 mb-3 relative inline-block group border-4 border-black rounded-full overflow-hidden w-36 h-36 bg-zinc-900 shadow-2xl"><MediaWithLoader src={pUser.photoURL} className="w-full h-full" fallbackChar={pUser.username} type="avatar" objectFit="cover"/><OnlineBadge userId={pid} size='lg'/></div>
             <div className="flex justify-between items-start">
                <div><div className={`text-2xl font-black flex items-center gap-1 ${textClass}`}>{pUser.fullName} <VerifiedBadge isVerified={pUser.verified} /></div><div className="text-zinc-500">@{pUser.username}</div></div>
                <div className="flex gap-2">
                  {isMe ? (<>
                        <button onClick={()=>setIsEditing(true)} className={`border px-5 py-2 rounded-full font-bold transition-colors ${theme==='light'?'border-gray-300 hover:bg-gray-100 text-black':'border-zinc-600 hover:bg-zinc-900 text-white'}`}>Edit Profile</button>
                        <div className="relative"><button onClick={() => setShowProfileSettings(!showProfileSettings)} className={`p-2 rounded-full border ${theme === 'light' ? 'border-gray-300 hover:bg-gray-100 text-black' : 'border-zinc-600 hover:bg-zinc-900 text-white'}`}><Settings size={20} /></button>
                           {showProfileSettings && (<div className={`absolute right-0 top-full mt-2 w-48 rounded-2xl shadow-xl border overflow-hidden z-50 backdrop-blur-xl ${theme === 'light' ? 'bg-white/90 border-gray-200' : 'bg-black/80 border-white/10'}`}>
                                 <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-opacity-50 ${theme==='light'?'hover:bg-gray-100':'hover:bg-white/10'} ${textClass}`}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</button>
                                 <button onClick={() => { setShowProfileSettings(false); setShowLogoutConfirm(true); }} className={`w-full text-left px-4 py-3 flex items-center gap-3 text-red-500 hover:bg-opacity-50 ${theme==='light'?'hover:bg-gray-100':'hover:bg-white/10'}`}><LogOut size={18} /> Log Out</button>
                              </div>)}
                        </div>
                     </>) : (<button onClick={()=>toggleFollow(pid)} className={`px-6 py-2 rounded-full font-bold transition-all shadow-lg active:scale-95 ${following.includes(pid)?(theme==='light'?'border border-zinc-400 text-zinc-600':'border border-zinc-600 text-white'):(theme==='light'?'bg-black text-white hover:opacity-80':'bg-white text-black hover:scale-105')}`}>{following.includes(pid)?'Following':'Follow'}</button>)}
                </div>
             </div>
             <p className={`mt-4 text-[15px] leading-relaxed max-w-lg ${textClass}`}>{pUser.bio}</p>
             <div className="flex gap-6 mt-4 text-sm"><span><strong className={textClass}>{formatCount(pUser.followingCount)}</strong> <span className="text-zinc-500">Following</span></span><span><strong className={textClass}>{formatCount(pUser.followersCount)}</strong> <span className="text-zinc-500">Followers</span></span></div>
          </div>
          {userPosts.map(p => {
             const rootId = p.isRepost ? p.originalPostId : p.id;
             const repostId = `${user.uid}_repost_${rootId}`;
             const isRepostedByMe = posts.some(r => r.id === repostId);
             return <Tweet key={p.id} post={p} currentUser={profile} onDelete={deletePost} onComment={setActivePost} onRepostToggle={handleToggleRepost} onQuote={setQuotePost} isRepostedByMe={isRepostedByMe} theme={theme} onUserClick={(id)=>{setViewProfileId(id);setView('profile')}} allUsers={users}/>;
          })}
       </div>
    );
  };

  return (
    <div className={`min-h-screen font-sans flex justify-center relative ${bgClass} bg-[url('https://grainy-gradients.vercel.app/noise.svg')]`} onTouchStart={swipeHandlers.onTouchStart} onTouchMove={swipeHandlers.onTouchMove} onTouchEnd={swipeHandlers.onTouchEnd}>
      <div className="flex w-full max-w-7xl relative z-10">
        <div className={`hidden md:flex flex-col w-20 xl:w-72 p-4 border-r ${borderClass} h-screen sticky top-0 justify-between`}>
           <div className="space-y-2">
              <div className="mb-6 p-2 w-fit cursor-pointer" onClick={()=>handleNavClick('home')}><TruthSpaceLogo size={42}/></div>
              {[{ id: 'home', icon: Home, label: 'Home' },{ id: 'search', icon: Compass, label: 'Explore' },{ id: 'notifications', icon: Bell, label: 'Notifications' },{ id: 'profile', icon: User, label: 'Profile' },{ id: 'settings', icon: Settings, label: 'Settings' }].map(item => (
                <button key={item.id} onClick={()=>{ if(item.id==='profile') setViewProfileId(null); if(item.id==='search') setSearchTerm(''); handleNavClick(item.id); }} className={`relative flex items-center gap-5 text-xl p-3.5 rounded-full w-fit xl:w-full transition-all active:scale-95 ${view===item.id ? (theme==='light'?'bg-gray-100 font-bold text-black':'bg-white/10 font-bold text-white') : 'text-zinc-500 hover:bg-white/5'}`}>
                  <div className="relative">
                    <item.icon size={26} strokeWidth={view===item.id?2.8:2} />
                    {item.id === 'notifications' && unreadCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] flex items-center justify-center text-white border-2 border-black"></span>}
                  </div>
                  <span className="hidden xl:block">{item.label}</span>
                  {item.id === 'notifications' && unreadCount > 0 && <span className="hidden xl:flex ml-auto bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{unreadCount}</span>}
                </button>
              ))}
              <button onClick={()=>{handleNavClick('home'); window.scrollTo(0,0)}} className="bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-full py-3.5 w-full mt-6 shadow-lg shadow-blue-500/30 hidden xl:block active:scale-95 transition-transform">Post Truth</button>
           </div>
           <div className={`flex items-center gap-3 cursor-pointer p-3 rounded-full ${theme==='light'?'hover:bg-gray-100':'hover:bg-white/5'}`} onClick={()=>{setViewProfileId(null);setView('profile')}}>
              <div className="relative w-10 h-10 rounded-full overflow-hidden border border-zinc-700"><MediaWithLoader src={profile?.photoURL} className="w-full h-full" fallbackChar={profile?.username} type="avatar"/><OnlineBadge userId={user.uid}/></div>
              <div className="hidden xl:block overflow-hidden"><div className={`text-sm font-bold truncate ${textClass}`}>{profile?.fullName}</div><div className="text-xs text-zinc-500 truncate">{profile?.handle}</div></div>
           </div>
        </div>

        <main className={`flex-1 border-r ${borderClass} max-w-2xl min-h-screen relative pb-20 ${theme==='light'?'bg-white':'bg-[#050505]'}`}>
           {view === 'home' && (
             <>
               <div className={`p-4 border-b ${borderClass} sticky top-0 backdrop-blur-xl z-20 flex justify-between items-center transition-all ${theme==='light'?'bg-white/90':'bg-black/80'}`} onClick={()=>window.scrollTo({top:0, behavior:'smooth'})}>
                 <div className="flex items-center gap-2 cursor-pointer">
                    <h2 className={`font-bold text-xl ${textClass}`}>Home</h2>
                    {isAnalyzingFeed && <Loader2 className="animate-spin text-blue-500" size={16}/>}
                 </div>
                 <Sparkles size={20} className="text-blue-400 animate-pulse" />
               </div>
               
               {/* Pull To Refresh Indicator */}
               {(pulling || refreshing) && (
                  <div className="w-full flex justify-center py-4 bg-transparent absolute top-14 left-0 z-10 transition-all">
                     <div className={`p-2 rounded-full ${theme==='light'?'bg-white shadow-md':'bg-zinc-800'} transition-transform ${refreshing ? 'animate-spin' : ''}`} style={{transform: `scale(${pulling ? 1.2 : 1})`}}>
                        <RefreshCw size={20} className={refreshing ? 'text-blue-500' : 'text-zinc-500'} />
                     </div>
                  </div>
               )}

               <div className={`p-4 border-b ${borderClass} flex gap-4 transition-transform duration-300 ${refreshing ? 'translate-y-8' : 'translate-y-0'}`}>
                  <div className="w-11 h-11 rounded-full overflow-hidden shrink-0"><MediaWithLoader src={profile?.photoURL} className="w-full h-full" fallbackChar={profile?.username} type="avatar" objectFit="cover"/></div>
                  <div className="flex-1">
                     <textarea value={postTxt} onChange={e=>setPostTxt(e.target.value)} className={`w-full bg-transparent text-xl outline-none resize-none min-h-[50px] mb-2 ${theme==='light'?'placeholder-gray-400 text-black':'placeholder-zinc-600 text-white'}`} placeholder="What is happening?!"/>
                     
                     {/* Preview + Progress Bar */}
                     {filePreview && (
                       <div className="relative mb-4 w-full overflow-hidden rounded-2xl bg-black border border-zinc-800 shadow-xl">
                          {file && file.type.startsWith('video/') ? (
                             <video src={filePreview} className="w-full h-auto max-h-[400px]" controls />
                          ) : (
                             <img src={filePreview} className="w-full h-auto max-h-[400px] object-contain" alt="preview"/>
                          )}
                          {!isPosting && (
                             <button onClick={()=>{setFile(null); setFilePreview(null);}} className="absolute top-2 right-2 bg-black/70 p-1.5 rounded-full text-white hover:bg-black/90 transition-colors"><X size={16}/></button>
                          )}
                          {isPosting && (
                             <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center">
                                <div className="w-2/3 bg-zinc-700/50 rounded-full h-1.5 mb-2 overflow-hidden">
                                   <div className="bg-blue-500 h-full rounded-full transition-all duration-300 shadow-[0_0_10px_rgba(59,130,246,0.5)]" style={{width: `${uploadProgress}%`}}></div>
                                </div>
                                <span className="text-white text-xs font-bold tracking-wider">UPLOADING {uploadProgress}%</span>
                             </div>
                          )}
                       </div>
                     )}

                     <div className={`flex justify-between items-center border-t ${borderClass} pt-3 mt-2`}>
                        <div className="flex gap-2 text-blue-400"><input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="image/*,video/*" />
                           <button onClick={()=>fileInputRef.current.click()} className="p-2 hover:bg-blue-500/10 rounded-full transition-colors"><ImageIcon size={20}/></button>
                           <button onClick={()=>fileInputRef.current.click()} className="p-2 hover:bg-blue-500/10 rounded-full transition-colors"><VideoIcon size={20}/></button>
                           <button onClick={()=>setShowAI(true)} className="p-2 hover:bg-purple-500/10 text-purple-400 rounded-full transition-colors"><Wand2 size={20}/></button>
                        </div>
                        <button onClick={createPost} disabled={(!postTxt.trim() && !file) || isPosting} className="bg-blue-600 px-6 py-2 rounded-full font-bold text-sm disabled:opacity-50 text-white flex items-center gap-2 hover:bg-blue-500 active:scale-95 transition-all shadow-lg shadow-blue-500/20">
                           {isPosting ? <Loader2 className="animate-spin" size={16}/> : 'Post'}
                        </button>
                     </div>
                  </div>
               </div>
               
               {feedPosts.map(p => {
                 const rootId = p.isRepost ? p.originalPostId : p.id;
                 const repostId = `${user.uid}_repost_${rootId}`;
                 const isRepostedByMe = posts.some(r => r.id === repostId);
                 return <Tweet key={p.id} post={p} currentUser={profile} onDelete={deletePost} onComment={setActivePost} onRepostToggle={handleToggleRepost} onQuote={setQuotePost} isRepostedByMe={isRepostedByMe} theme={theme} onUserClick={(id)=>{setViewProfileId(id);setView('profile')}} allUsers={users}/>;
               })}
             </>
           )}
           {view === 'notifications' && <NotificationsView user={user} theme={theme} />}
           {view === 'settings' && <SettingsView theme={theme} setTheme={setTheme} onLogout={()=>signOut(auth)} />}
           {view === 'search' && (
              <div className="p-4">
                 <div className={`flex items-center p-3 rounded-full mb-6 border ${borderClass} sticky top-2 z-20 backdrop-blur-xl ${theme==='light'?'bg-white/80':'bg-black/50'}`}><Search className="text-zinc-500 mr-3" size={20}/><input autoFocus value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} className={`bg-transparent outline-none w-full ${textClass}`} placeholder="Search TruthSpace"/></div>
                 {filteredUsers.map(u => (
                    <div key={u.id} onClick={()=>{setViewProfileId(u.id);setView('profile')}} className={`flex justify-between items-center p-3 rounded-2xl cursor-pointer ${theme==='light'?'hover:bg-gray-50':'hover:bg-white/5'} transition-colors`}>
                       <div className="flex gap-3 items-center"><div className="w-10 h-10 rounded-full overflow-hidden"><MediaWithLoader src={u.photoURL} className="w-full h-full" fallbackChar={u.username} type="avatar" objectFit="cover"/></div><div><div className={`font-bold flex items-center ${textClass}`}>{u.fullName} <VerifiedBadge isVerified={u.verified}/></div><div className="text-zinc-500 text-sm">@{u.username}</div></div></div>
                    </div>
                 ))}
              </div>
           )}
           {view === 'profile' && renderProfile()}
        </main>
        
        <div className="hidden lg:block w-80 xl:w-96 p-4 pl-8 space-y-6">
           <div className={`border ${borderClass} rounded-3xl p-6 ${theme==='light'?'bg-gray-50':'bg-white/5'} backdrop-blur-md`}>
              <h2 className={`font-bold text-xl mb-4 px-2 ${textClass}`}>Who to follow</h2>
              {users.filter(u=>u.id!==user.uid && !following.includes(u.id)).slice(0,3).map(u => (
                 <div key={u.id} className={`flex justify-between items-center cursor-pointer p-3 rounded-2xl ${theme==='light'?'hover:bg-white':'hover:bg-white/5'} transition-colors`} onClick={()=>{setViewProfileId(u.id);setView('profile')}}>
                    <div className="flex gap-3 items-center overflow-hidden"><div className="w-10 h-10 rounded-full overflow-hidden shrink-0"><MediaWithLoader src={u.photoURL} className="w-full h-full" fallbackChar={u.username} type="avatar" objectFit="cover"/></div><div className="truncate"><div className={`font-bold text-sm truncate flex items-center ${textClass}`}>{u.fullName} <VerifiedBadge isVerified={u.verified}/></div><div className="text-zinc-500 text-xs truncate">@{u.username}</div></div></div>
                    <button onClick={(e)=>{e.stopPropagation();toggleFollow(u.id)}} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-transform active:scale-95 ${theme==='light'?'bg-black text-white hover:bg-gray-800':'bg-white text-black hover:bg-gray-200'}`}>Follow</button>
                 </div>
              ))}
           </div>
        </div>
      </div>

      <div className={`md:hidden fixed bottom-0 w-full backdrop-blur-xl border-t ${borderClass} flex justify-around p-3 z-50 pb-6 ${theme==='light'?'bg-white/90':'bg-black/90'}`}>
         <button onClick={()=>handleNavClick('home')} className={`p-2 rounded-full active:scale-90 transition-transform ${view==='home'?(theme==='light'?'text-black':'text-white'):'text-zinc-500'}`}><Home size={28}/></button>
         <button onClick={()=>{setSearchTerm('');setView('search')}} className={`p-2 rounded-full active:scale-90 transition-transform ${view==='search'?(theme==='light'?'text-black':'text-white'):'text-zinc-500'}`}><Search size={28}/></button>
         <button onClick={()=>{if(view!=='profile') setView('home'); setTimeout(()=>document.querySelector('input[type="file"]')?.click(), 100)}} className={`p-3 rounded-full bg-blue-600 text-white shadow-lg shadow-blue-500/40 -mt-10 border-4 active:scale-95 transition-transform ${theme==='light'?'border-white':'border-black'}`}><PlusCircle size={32}/></button>
         <button onClick={()=>{handleNavClick('notifications')}} className={`relative p-2 rounded-full active:scale-90 transition-transform ${view==='notifications'?(theme==='light'?'text-black':'text-white'):'text-zinc-500'}`}>
           <Bell size={28}/>
           {unreadCount > 0 && <span className="absolute top-1 right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-black"></span>}
         </button>
         <button onClick={()=>{setViewProfileId(null);handleNavClick('profile')}} className={`p-2 rounded-full active:scale-90 transition-transform ${view==='profile'?(theme==='light'?'text-black':'text-white'):'text-zinc-500'}`}><User size={28}/></button>
      </div>

      {activePost && <CommentsModal post={activePost} user={profile} onClose={()=>setActivePost(null)} theme={theme} />}
      {quotePost && <QuoteModal postToQuote={quotePost} user={profile} onClose={()=>setQuotePost(null)} theme={theme} />}
      {isEditing && <EditProfileModal user={profile} onClose={()=>setIsEditing(false)} theme={theme} />}
      {showAI && <AIAssistantModal initialText={postTxt} onApply={(txt)=>{setPostTxt(txt); setShowAI(false)}} onClose={()=>setShowAI(false)} theme={theme} />}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
           <div className={`w-full max-w-sm rounded-3xl p-6 shadow-2xl border ${theme==='light'?'bg-white border-gray-200 text-black':'bg-zinc-900 border-zinc-800 text-white'}`}>
              <h2 className="text-xl font-bold mb-2">Log out of TruthSpace?</h2>
              <p className="text-zinc-500 mb-6">You can always log back in at any time.</p>
              <div className="flex flex-col gap-3"><button onClick={() => { signOut(auth); setShowLogoutConfirm(false); }} className="w-full bg-white text-black font-bold py-3 rounded-2xl hover:bg-gray-200 transition-colors">Log out</button><button onClick={() => setShowLogoutConfirm(false)} className="w-full border border-zinc-600 text-zinc-500 hover:text-zinc-300 font-bold py-3 rounded-2xl transition-colors">Cancel</button></div>
           </div>
        </div>
      )}
    </div>
  );
}


```
