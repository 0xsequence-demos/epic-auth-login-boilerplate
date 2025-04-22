import { useEffect, useState } from 'react'
import { sequenceWaas } from "./SequenceEmbeddedWallet";

import './App.css'

// Get the worker login URL from environment variables
const workerLoginUrl = (import.meta.env.VITE_WORKER_LOGIN_URL || '').replace(/\/$/, '') + '/login'; // Ensure trailing slash is removed before adding /login

function App() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)


  // UseEffect to handle the redirect back from the worker
  useEffect(() => {
    const hash = window.location.hash;
    const searchParams = new URLSearchParams(window.location.search);
    const loginError = searchParams.get('epic_login_error');

    // Check for errors first
    if (loginError) {
      setError(`Epic Login Failed: ${loginError}`);
      // Clear the error query parameters from the URL
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
    // Handle successful login via hash
    else if (hash.startsWith('#epic_jwt=')) {
      setIsLoading(true);
      setError(null);
      const epicJwt = hash.substring('#epic_jwt='.length);

      // Clear the hash from the URL
      window.history.replaceState(null, '', window.location.pathname + window.location.search);


      const signInWithEpic = async (token: string) => {
        console.log(token)

        try {
          console.log("Attempting Sequence WaaS sign in with Epic JWT...");
          const res = await sequenceWaas.signIn(
            { idToken: token }, // Pass the Epic JWT as idToken
            "Epic Auth Session" // Session name/identifier
          );
          console.log("Sequence WaaS sign in successful:", res);
          setWalletAddress(res.wallet);
        } catch (err) {
          console.error("Sequence WaaS sign in failed:", err);
          setError("Failed to sign in with Sequence WaaS using Epic token.");
        } finally {
          setIsLoading(false);
        }
      };

      signInWithEpic(epicJwt);
    } else {
      // Only check for existing session if not handling a login attempt (hash or error)
      const checkSession = async () => {
         setIsLoading(true);
         setError(null); // Clear previous errors
         try {
           // Attempt to get the current session without triggering UI
           const session = await sequenceWaas.listSessions();
           if (session) {
             console.log("Found existing Sequence session:", session);
             const walletAddress = await sequenceWaas.getAddress()
             setWalletAddress(walletAddress);
           } else {
             console.log("No active Sequence session found on load.");
           }
         } catch (err) {
           // Treat error as no session existing
           console.warn("Error checking for Sequence session:", err);
         } finally {
           setIsLoading(false);
         }
       }
       checkSession();
    }
  }, []); // Run only once on component mount

  // Function to handle sending a transaction
  const handleSendTransaction = async () => {
    if (!walletAddress) {
      setError('Wallet address not found. Please sign in.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {

      const walletAddress = sequenceWaas.getAddress()
      

      const txResponse = await sequenceWaas.sendTransaction({
        transactions: [
          {
            to: walletAddress,
            value: "0",
          },
        ],
        network: 42170,
      });


      console.log('Transaction sent:', txResponse);
      alert(`Transaction successful! Hash: ${txResponse}`); // Simple feedback

    } catch (err: any) {
      console.error("Transaction failed:", err);
      setError(`Transaction failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  }

  const signOut = async () => {
    try {
      setIsLoading(true);
      setError(null);
      // Drop all sessions might be aggressive, consider dropping current if possible
      // const currentSessionId = await sequenceWaas.getSessionId();
      // if(currentSessionId) await sequenceWaas.dropSession({ sessionId: currentSessionId })
      // For simplicity now, drop all:
      const sessions = await sequenceWaas.listSessions()
      console.log(`Dropping ${sessions.length} sessions...`);
      for(let i = 0; i < sessions.length; i++){
        await sequenceWaas.dropSession({ sessionId: sessions[i].id })
      }
      setWalletAddress(null)
      console.log("Signed out and sessions dropped.");
    } catch (err) {
      console.error("Sign out failed:", err);
      setError("Failed to sign out.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <h1 className='title'>Embedded Wallet - Epic Games Auth</h1>
      

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        margin: 'auto',
        gap: '1rem'
    }}>
    </div>


      <div style={{
        display: 'flex',
        flexDirection: 'column', // Stack items vertically
        alignItems: 'center',
        margin: 'auto',
        marginTop: '20px', // Add some top margin for spacing
        gap: '20px' // Add some space between elements
      }}>
        {isLoading && <p>Loading...</p>}
        {error && <p style={{ color: 'red' }}>Error: {error}</p>}

        {!walletAddress && !isLoading && (
          // Replace GoogleLogin with a link to the worker login
          <a href={workerLoginUrl} className="login-button" aria-label="Login with Epic Games"> {/* Add aria-label for accessibility */}
            <img 
              src="https://upload.wikimedia.org/wikipedia/commons/3/31/Epic_Games_logo.svg" 
              alt="Epic Games Logo" 
              style={{ width: '32px', height: '32px' }} // Adjust size as needed
            />
          </a>
        )}
        {walletAddress && (
          <div>
            <p>Signed in!</p>
            <p>Wallet Address: {walletAddress}</p>
            {/* You might want to display Epic Games user info here too if needed */}
          </div>
        )}
      </div>
    </>
  )
}

export default App
