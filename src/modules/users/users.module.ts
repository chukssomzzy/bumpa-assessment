import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserProgressEntity } from './user-progress.entity';
import { UserEntity } from './user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, UserProgressEntity])],
  exports: [TypeOrmModule],
})
export class UsersModule {}
