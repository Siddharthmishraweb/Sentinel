import { Database } from '../utils/database';
import { RedisClient } from '../utils/redis';

interface ComponentHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  responseTime?: number;
  details?: Record<string, any>;
}

interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    memory: ComponentHealth;
    cpu: ComponentHealth;
  };
}

export class HealthService {
  private database: Database;
  private redis: RedisClient;
  private startTime: number;

  constructor() {
    this.database = Database.getInstance();
    this.redis = RedisClient.getInstance();
    this.startTime = Date.now();
  }

  public async getStatus(): Promise<HealthStatus> {
    const components = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkMemory(),
      this.checkCPU()
    ]);

    const [database, redis, memory, cpu] = components.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        const componentNames = ['database', 'redis', 'memory', 'cpu'];
        return {
          status: 'unhealthy' as const,
          message: `Health check failed: ${result.reason?.message || 'Unknown error'}`,
          details: { component: componentNames[index] }
        };
      }
    });

    // Determine overall status
    const componentStatuses = [database, redis, memory, cpu];
    let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

    if (componentStatuses.some(c => c.status === 'unhealthy')) {
      overallStatus = 'unhealthy';
    } else if (componentStatuses.some(c => c.status === 'degraded')) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: process.env.npm_package_version || '1.0.0',
      components: {
        database,
        redis,
        memory,
        cpu
      }
    };
  }

  private async checkDatabase(): Promise<ComponentHealth> {
    const start = Date.now();
    
    try {
      const isHealthy = await this.database.isHealthy();
      const responseTime = Date.now() - start;

      if (!isHealthy) {
        return {
          status: 'unhealthy',
          message: 'Database connection failed',
          responseTime
        };
      }

      // Check if response time is too slow
      if (responseTime > 1000) {
        return {
          status: 'degraded',
          message: 'Database response time is slow',
          responseTime,
          details: { threshold: 1000 }
        };
      }

      return {
        status: 'healthy',
        responseTime
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        message: `Database error: ${error.message}`,
        responseTime: Date.now() - start
      };
    }
  }

  private async checkRedis(): Promise<ComponentHealth> {
    const start = Date.now();

    try {
      const isHealthy = await this.redis.healthCheck();
      const responseTime = Date.now() - start;

      if (!isHealthy) {
        return {
          status: 'unhealthy',
          message: 'Redis connection failed',
          responseTime
        };
      }

      if (responseTime > 500) {
        return {
          status: 'degraded',
          message: 'Redis response time is slow',
          responseTime,
          details: { threshold: 500 }
        };
      }

      return {
        status: 'healthy',
        responseTime
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        message: `Redis error: ${error.message}`,
        responseTime: Date.now() - start
      };
    }
  }

  private checkMemory(): ComponentHealth {
    try {
      const memoryUsage = process.memoryUsage();
      const totalMemoryMB = memoryUsage.heapTotal / 1024 / 1024;
      const usedMemoryMB = memoryUsage.heapUsed / 1024 / 1024;
      const usagePercentage = (usedMemoryMB / totalMemoryMB) * 100;

      if (usagePercentage > 90) {
        return {
          status: 'unhealthy',
          message: 'Memory usage critically high',
          details: {
            usagePercentage: Math.round(usagePercentage),
            usedMB: Math.round(usedMemoryMB),
            totalMB: Math.round(totalMemoryMB)
          }
        };
      }

      if (usagePercentage > 75) {
        return {
          status: 'degraded',
          message: 'Memory usage high',
          details: {
            usagePercentage: Math.round(usagePercentage),
            usedMB: Math.round(usedMemoryMB),
            totalMB: Math.round(totalMemoryMB)
          }
        };
      }

      return {
        status: 'healthy',
        details: {
          usagePercentage: Math.round(usagePercentage),
          usedMB: Math.round(usedMemoryMB),
          totalMB: Math.round(totalMemoryMB)
        }
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        message: `Memory check failed: ${error.message}`
      };
    }
  }

  private checkCPU(): ComponentHealth {
    try {
      const cpuUsage = process.cpuUsage();
      const userTime = cpuUsage.user / 1000; // Convert to milliseconds
      const systemTime = cpuUsage.system / 1000;
      const totalTime = userTime + systemTime;

      // This is a simple approximation - in production you might want
      // to track CPU usage over time
      return {
        status: 'healthy',
        details: {
          userTime,
          systemTime,
          totalTime
        }
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        message: `CPU check failed: ${error.message}`
      };
    }
  }

  public async isHealthy(): Promise<boolean> {
    const status = await this.getStatus();
    return status.status === 'healthy';
  }

  public getUptime(): number {
    return Date.now() - this.startTime;
  }
}

export default HealthService;