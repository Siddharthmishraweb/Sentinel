import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  X, 
  AlertTriangle, 
  Shield, 
  FileText, 
  CheckCircle, 
  Clock, 
  Phone,
  CreditCard
} from 'lucide-react';

interface TriageDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  alert: any;
  onAssignAgent?: (alertId: string) => void;
}

interface TriageEvent {
  type: 'plan_built' | 'tool_update' | 'fallback_triggered' | 'decision_finalized' | 'error' | 'connected' | 'stream_complete';
  data?: any;
  timestamp: number;
}

interface TriageDecision {
  risk_score: number;
  risk_level: string;
  recommended_action: string;
  requires_otp: boolean;
  reasons: string[];
  confidence: number;
  fallback_used?: boolean;
}

const TriageDrawer: React.FC<TriageDrawerProps> = ({ isOpen, onClose, alert }) => {
  const [triageState, setTriageState] = useState<'idle' | 'starting' | 'running' | 'completed' | 'error'>('idle');
  const [events, setEvents] = useState<TriageEvent[]>([]);
  const [decision, setDecision] = useState<TriageDecision | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const focusTrapSentinelStart = useRef<HTMLSpanElement>(null);
  const focusTrapSentinelEnd = useRef<HTMLSpanElement>(null);
  const reconnectAttemptsRef = useRef(0);
  const currentRunIdRef = useRef<string | null>(null);

  // Force cleanup of any existing EventSource connections
  const forceCleanup = useCallback(() => {
    if (eventSourceRef.current) {
      console.log('Force closing EventSource connection');
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    currentRunIdRef.current = null;
    reconnectAttemptsRef.current = 0;
  }, []);

  // Focus management for accessibility
  useEffect(() => {
    if (isOpen && drawerRef.current) {
      lastFocusedElementRef.current = document.activeElement as HTMLElement;
      const focusableElements = drawerRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0] as HTMLElement;
      firstElement?.focus();
    } else if (!isOpen && lastFocusedElementRef.current) {
      // Restore focus
      lastFocusedElementRef.current.focus();
    }
  }, [isOpen]);

  // Handle ESC key
  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
    }

    return () => {
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);

  // Reset state when drawer closes
  useEffect(() => {
    if (!isOpen) {
      // Force stop any ongoing streams
      forceCleanup();
      // Reset state for next triage session
      setTriageState('idle');
      setEvents([]);
      setDecision(null);
      setStreamError(null);
    }
  }, [isOpen, forceCleanup]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  // Centralize API key (could be replaced with process.env via build-time injection)
  const API_KEY = 'sentinel-api-key-2024';

  const startTriage = async () => {
    if (!alert || triageState === 'starting') return;

    console.log('Starting triage for alert:', alert.id, 'customer:', alert.customer_id);
    
    // Force cleanup any existing connections first
    forceCleanup();
    
    setTriageState('starting');
    setEvents([]);
    setDecision(null);
    setStreamError(null);

    try {
      // Correct endpoint path is POST /api/triage/ (root of triage router)
      const response = await fetch('/api/triage/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY
        },
        body: JSON.stringify({
          alertId: alert.id,
          customerId: alert.customer_id,
          transactionId: alert.transaction_id
        })
      });

      console.log('Triage start response status:', response.status);

      if (!response.ok) {
        const text = await response.text();
        console.error('Triage start failed:', response.status, text);
        if (response.status === 401) {
          throw new Error('Unauthorized (API key). Verify frontend API key matches server API_KEY env. Raw: ' + text.slice(0,120));
        }
        throw new Error(`Start triage failed (${response.status}): ${text.slice(0,120)}`);
      }

      const data = await response.json();
      console.log('Triage started successfully, data:', data);
      const runId = data.runId || data.run_id;
      if (!runId) {
        throw new Error('Missing runId in triage start response');
      }
      
      // Store the current run ID to prevent stale connections
      currentRunIdRef.current = runId;
      console.log('Setting current run ID to:', runId);
      
      setTriageState('running');
      startEventStream(runId);
    } catch (error: any) {
      console.error('Failed to start triage:', error);
      setStreamError(error.message || 'Unknown error starting triage');
      setTriageState('error');
    }
  };

  const startEventStream = useCallback((runId: string) => {
    // Only start stream if this is still the current run ID
    if (currentRunIdRef.current !== runId) {
      console.log('Skipping stream for stale run ID:', runId, 'current:', currentRunIdRef.current);
      return;
    }

    setStreamError(null);
    reconnectAttemptsRef.current = 0;

    console.log('Starting event stream for runId:', runId);

    const connect = () => {
      // Check again if this is still the current run ID
      if (currentRunIdRef.current !== runId) {
        console.log('Aborting connection for stale run ID:', runId);
        return;
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
  // Pass API key and preferred poll interval (ms) for backend adaptive scheduling
  const streamUrl = `/api/triage/${runId}/stream?apiKey=${API_KEY}&interval=1000`;
  console.log('Connecting to EventSource:', streamUrl);
  const es = new EventSource(streamUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        console.log('EventSource connected successfully');
        reconnectAttemptsRef.current = 0;
      };

      const handleGeneric = (ev: MessageEvent, explicitType?: string) => {
        try {
          const parsed = JSON.parse(ev.data);
          const type = explicitType || parsed.type;
          console.log('Received event:', type, parsed);
          
          if (type === 'connected') {
            setTriageState('running');
            return;
          }
          if (type === 'error') {
            console.error('Stream error event:', parsed);
            setStreamError(parsed.error || 'Stream error');
            setTriageState('error');
            es.close();
            return;
          }
          if (type === 'stream_complete') {
            console.log('Stream completed');
            // Stream is complete, but don't change state if we already have a decision
            setTriageState(prev => prev === 'completed' || prev === 'error' ? prev : 'completed');
            es.close();
            return;
          }
          // Record normal event types
          setEvents(prev => {
            const newEvents = [...prev, { type: type as any, data: parsed.data, timestamp: parsed.timestamp || Date.now() }];
            console.log('Updated events:', newEvents);
            return newEvents;
          });
          if (type === 'decision_finalized') {
            console.log('Decision finalized:', parsed.data);
            setDecision(parsed.data);
            setTriageState('completed');
          }
        } catch (error) {
          console.log('Ignoring non-JSON event or heartbeat');
        }
      };

      ['plan_built','tool_update','fallback_triggered','decision_finalized','stream_complete','error','connected'].forEach(evt => {
        es.addEventListener(evt, ev => handleGeneric(ev as MessageEvent, evt));
      });

      es.onerror = (event) => {
        console.error('EventSource error:', event, 'readyState:', es.readyState);
        es.close();
        
        // Don't reconnect if drawer is closed, triage is done, or this is a stale run ID
        if (!isOpen || triageState === 'completed' || triageState === 'error' || currentRunIdRef.current !== runId) {
          console.log('Not reconnecting - drawer closed, triage done, or stale run ID');
          return;
        }
        
        const attempt = reconnectAttemptsRef.current++;
        const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`Reconnection attempt ${attempt}/5 after ${backoff}ms for run ID: ${runId}`);
        if (attempt >= 5) {
          setStreamError('Unable to establish stream after multiple attempts');
          setTriageState('error');
          return;
        }
        setTimeout(connect, backoff);
      };
    };

    connect();
  }, [triageState, events]);

  const executeAction = async (action: string) => {
    if (!decision || !alert) return;

    try {
      let response;
      
      if (action === 'freeze_card') {
        response = await fetch('/api/action/freeze-card', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'sentinel-api-key-2024',
            'Idempotency-Key': `freeze-${alert.id}-${Date.now()}`
          },
          body: JSON.stringify({
            cardId: alert.card_id || '1234',
            reason: 'Fraud prevention - triage recommendation'
          }),
        });
      } else if (action === 'open_dispute') {
        response = await fetch('/api/action/open-dispute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'sentinel-api-key-2024',
            'Idempotency-Key': `dispute-${alert.id}-${Date.now()}`
          },
          body: JSON.stringify({
            txnId: alert.transaction_id || alert.id,
            reasonCode: '10.4',
            confirm: true,
            customerId: alert.customer_id
          }),
        });
      } else if (action === 'contact_customer') {
        response = await fetch('/api/action/contact-customer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'sentinel-api-key-2024',
            'Idempotency-Key': `contact-${alert.id}-${Date.now()}`
          },
          body: JSON.stringify({
            customerId: alert.customer_id,
            communicationType: 'email',
            template: 'fraud_alert',
            message: 'We detected suspicious activity on your account. Please review your recent transactions and contact us if you notice any unauthorized activity.'
          }),
        });
      } else if (action === 'mark_false_positive') {
        response = await fetch('/api/action/mark-false-positive', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'sentinel-api-key-2024',
            'Idempotency-Key': `false-positive-${alert.id}-${Date.now()}`
          },
          body: JSON.stringify({
            alertId: alert.id,
            reason: 'Manually reviewed and determined to be false positive based on AI triage analysis'
          }),
        });
      }

      if (response && response.ok) {
        const result = await response.json();
        
        if (result.status === 'PENDING_OTP') {
          // Handle OTP requirement
          const otp = prompt('Enter OTP (use 123456 for demo):');
          if (otp) {
            // Retry with OTP
            await executeActionWithOtp(action, otp);
          }
        } else {
          window.alert(`Action completed: ${result.status}`);
        }
      } else {
        throw new Error(`Action failed: ${response?.statusText}`);
      }

    } catch (error: any) {
      console.error('Action execution failed:', error);
      window.alert(`Action failed: ${error.message}`);
    }
  };

  const executeActionWithOtp = async (_action: string, otp: string) => {
    if (!alert) return;

    try {
      const response = await fetch('/api/action/freeze-card', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'sentinel-api-key-2024',
          'Idempotency-Key': `freeze-otp-${alert.id}-${Date.now()}`
        },
        body: JSON.stringify({
          cardId: alert.card_id || '1234',
          otp: otp,
          reason: 'Fraud prevention - triage recommendation with OTP'
        }),
      });

      if (response.ok) {
        const result = await response.json();
        window.alert(`Action completed: ${result.status}`);
      } else {
        throw new Error(`Action failed: ${response.statusText}`);
      }

    } catch (error: any) {
      console.error('OTP action failed:', error);
      window.alert(`Action failed: ${error.message}`);
    }
  };

  const getRiskColor = (level: string) => {
    switch (level?.toLowerCase()) {
      case 'critical': return 'text-red-600 bg-red-50 border-red-200';
      case 'high': return 'text-orange-600 bg-orange-50 border-orange-200';
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'low': return 'text-blue-600 bg-blue-50 border-blue-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getActionIcon = (action: string) => {
    switch (action?.toLowerCase()) {
      case 'freeze_card': return <CreditCard className="h-5 w-5" />;
      case 'open_dispute': return <FileText className="h-5 w-5" />;
      case 'contact_customer': return <Phone className="h-5 w-5" />;
      default: return <AlertTriangle className="h-5 w-5" />;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black bg-opacity-50" 
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Drawer */}
      <div className="absolute right-0 top-0 h-full w-full max-w-2xl bg-white shadow-xl" aria-describedby="triage-status-live">
        <div 
          ref={drawerRef}
          className="flex h-full flex-col"
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-title"
        >
          <span ref={focusTrapSentinelStart} tabIndex={0} onFocus={() => {
            // Cycle focus to last focusable (exclude sentinels) without recursion
            if ((drawerRef.current as any)._cycling) return; // guard against re-entry
            (drawerRef.current as any)._cycling = true;
            const focusable = Array.from(drawerRef.current?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || [])
              .filter(el => el !== focusTrapSentinelStart.current && el !== focusTrapSentinelEnd.current);
            if (focusable.length > 0) {
              (focusable[focusable.length - 1] as HTMLElement).focus();
            }
            setTimeout(() => { if (drawerRef.current) (drawerRef.current as any)._cycling = false; }, 0);
          }} />
          {/* Header */}
          <div className="border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Shield className="h-6 w-6 text-blue-600" />
                <h2 id="drawer-title" className="text-lg font-semibold text-gray-900">
                  AI Triage Analysis
                </h2>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* Alert Info */}
            <div className="mb-6 rounded-lg border border-gray-200 p-4">
              <h3 className="text-lg font-medium text-gray-900 mb-2">{alert?.title}</h3>
              <p className="text-gray-600 mb-3">{alert?.description}</p>
              <div className="flex items-center space-x-4 text-sm text-gray-500">
                <span>Customer: {alert?.customer_id}</span>
                <span>Priority: {alert?.priority}</span>
                <span>Transaction: {alert?.transaction_id}</span>
              </div>
            </div>

            {/* Triage Controls */}
            <div className="mb-6">
              {triageState === 'idle' && (
                <button
                  onClick={startTriage}
                  className="btn-primary w-full"
                >
                  Start AI Triage
                </button>
              )}

              {triageState === 'starting' && (
                <div className="flex items-center justify-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                  <span className="ml-2 text-gray-600">Starting triage...</span>
                </div>
              )}
            </div>

            {/* Events Stream */}
            {events.length > 0 && (
              <div className="mb-6">
                <h4 className="font-medium text-gray-900 mb-3">Triage Progress</h4>
                <div 
                  className="space-y-2 max-h-40 overflow-y-auto" 
                  aria-live="polite"
                  aria-label="Triage progress updates"
                >
                  {events.map((event, index) => (
                    <div key={index} className="flex items-center space-x-2 text-sm">
                      <div className="flex-shrink-0">
                        {event.type === 'tool_update' && event.data?.success && (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        )}
                        {event.type === 'tool_update' && !event.data?.success && (
                          <AlertTriangle className="h-4 w-4 text-orange-500" />
                        )}
                        {event.type === 'fallback_triggered' && (
                          <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        )}
                        {event.type === 'decision_finalized' && (
                          <CheckCircle className="h-4 w-4 text-blue-500" />
                        )}
                        <Clock className="h-4 w-4 text-gray-400" />
                      </div>
                      <div className="flex-1">
                        {event.type === 'plan_built' && (
                          <span>Plan built with {event.data?.steps} steps</span>
                        )}
                        {event.type === 'tool_update' && (
                          <span>
                            {event.data?.step} ({event.data?.agent}) - 
                            {event.data?.success ? ' ✓' : ' ⚠'} 
                            {event.data?.duration_ms}ms
                            {event.data?.fallback_used && ' (fallback)'}
                          </span>
                        )}
                        {event.type === 'fallback_triggered' && (
                          <span className="text-yellow-600">Fallback triggered</span>
                        )}
                        {event.type === 'decision_finalized' && (
                          <span className="font-medium text-blue-600">Decision finalized</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error Display */}
            {streamError && triageState === 'error' && (
              <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                  <span className="text-red-700">Error: {streamError}</span>
                </div>
              </div>
            )}

            {/* Decision Results */}
            {decision && (
              <div className="space-y-6">
                {/* Risk Assessment */}
                <div className="rounded-lg border border-gray-200 p-4">
                  <h4 className="font-medium text-gray-900 mb-3">Risk Assessment</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">Risk Score:</span>
                      <span className="font-medium">{decision.risk_score}/100</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">Risk Level:</span>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full border ${getRiskColor(decision.risk_level)}`}>
                        {decision.risk_level}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">Confidence:</span>
                      <span className="font-medium">{Math.round(decision.confidence * 100)}%</span>
                    </div>
                  </div>
                </div>

                {/* Reasons */}
                <div className="rounded-lg border border-gray-200 p-4">
                  <h4 className="font-medium text-gray-900 mb-3">Key Indicators</h4>
                  <ul className="space-y-1">
                    {decision.reasons.map((reason, index) => (
                      <li key={index} className="flex items-center space-x-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-gray-400"></div>
                        <span className="text-gray-600 capitalize">{reason.replace(/_/g, ' ')}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Recommended Actions */}
                <div className="rounded-lg border border-gray-200 p-4">
                  <h4 className="font-medium text-gray-900 mb-3">Recommended Action</h4>
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      {getActionIcon(decision.recommended_action)}
                      <span className="font-medium capitalize">
                        {decision.recommended_action.replace(/_/g, ' ')}
                      </span>
                      {decision.requires_otp && (
                        <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">
                          OTP Required
                        </span>
                      )}
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="flex space-x-2 pt-2">
                      {decision.recommended_action === 'FREEZE_CARD' && (
                        <button
                          onClick={() => executeAction('freeze_card')}
                          className="btn-danger text-sm"
                        >
                          <CreditCard className="h-4 w-4 mr-2" />
                          Freeze Card
                        </button>
                      )}
                      
                      {decision.recommended_action === 'OPEN_DISPUTE' && (
                        <button
                          onClick={() => executeAction('open_dispute')}
                          className="btn-primary text-sm"
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          Open Dispute
                        </button>
                      )}
                      
                      <button 
                        onClick={() => executeAction('contact_customer')}
                        className="btn-secondary text-sm"
                      >
                        <Phone className="h-4 w-4 mr-2" />
                        Contact Customer
                      </button>
                      
                      <button 
                        onClick={() => executeAction('mark_false_positive')}
                        className="btn-secondary text-sm"
                      >
                        Mark False Positive
                      </button>
                    </div>
                  </div>
                </div>

                {decision.fallback_used && (
                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                    <div className="flex items-center space-x-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-600" />
                      <span className="text-yellow-800">
                        Some analysis tools were unavailable. Results may be less accurate.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div id="triage-status-live" className="sr-only" aria-live="assertive">
              {triageState === 'running' && 'Triage running'}
              {triageState === 'completed' && 'Triage completed'}
              {triageState === 'error' && 'Triage error'}
            </div>
          </div>
          <span ref={focusTrapSentinelEnd} tabIndex={0} onFocus={() => {
            // Cycle focus to first focusable (exclude sentinels) without recursion
            if ((drawerRef.current as any)._cycling) return;
            (drawerRef.current as any)._cycling = true;
            const focusable = Array.from(drawerRef.current?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || [])
              .filter(el => el !== focusTrapSentinelStart.current && el !== focusTrapSentinelEnd.current);
            if (focusable.length > 0) {
              (focusable[0] as HTMLElement).focus();
            }
            setTimeout(() => { if (drawerRef.current) (drawerRef.current as any)._cycling = false; }, 0);
          }} />
        </div>
      </div>
    </div>
  );
};

export default TriageDrawer;