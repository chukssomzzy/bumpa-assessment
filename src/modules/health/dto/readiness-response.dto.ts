import { ApiProperty } from '@nestjs/swagger';

/** One dependency's verdict, with the failure reason when it did not answer. */
export class DependencyStatusResponse {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status!: 'ok' | 'error';

  @ApiProperty({
    description: 'Why the check failed. Absent when the dependency answered.',
    required: false,
    example: 'connect ECONNREFUSED 127.0.0.1:5432',
  })
  error?: string;
}

class ReadinessDependencies {
  @ApiProperty({ type: DependencyStatusResponse })
  postgres!: DependencyStatusResponse;

  @ApiProperty({ type: DependencyStatusResponse })
  redis!: DependencyStatusResponse;
}

/** Documentation for `GET /health/ready`. Returned with 200 when healthy, 503 otherwise. */
export class ReadinessResponse {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status!: 'ok' | 'error';

  @ApiProperty({ type: ReadinessDependencies })
  dependencies!: ReadinessDependencies;
}
