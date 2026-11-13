package rw.nexera.nexguard.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow
import java.time.Instant

/** A location waiting to be uploaded. Kept on the phone while it is offline. */
@Entity(tableName = "pending_points")
data class PendingPoint(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val lat: Double,
    val lng: Double,
    val accuracyM: Float?,
    val source: String,
    val battery: Int?,
    val recordedAt: Long,
) {
    fun toDto() = PointDto(
        lat = lat,
        lng = lng,
        accuracyM = accuracyM?.toDouble(),
        source = source,
        battery = battery,
        recordedAt = Instant.ofEpochMilli(recordedAt).toString(),
    )
}

@Dao
interface PointDao {
    @Insert
    suspend fun insert(point: PendingPoint)

    @Query("SELECT * FROM pending_points ORDER BY recordedAt ASC LIMIT :limit")
    suspend fun oldest(limit: Int): List<PendingPoint>

    @Query("DELETE FROM pending_points WHERE id IN (:ids)")
    suspend fun delete(ids: List<Long>)

    /** Drops points too old to be useful, so a phone offline for weeks does not fill its storage. */
    @Query("DELETE FROM pending_points WHERE recordedAt < :before")
    suspend fun pruneBefore(before: Long)

    @Query("DELETE FROM pending_points")
    suspend fun clear()

    @Query("SELECT COUNT(*) FROM pending_points")
    fun countFlow(): Flow<Int>
}

@Database(entities = [PendingPoint::class], version = 1, exportSchema = false)
abstract class LocalDb : RoomDatabase() {
    abstract fun points(): PointDao

    companion object {
        @Volatile private var instance: LocalDb? = null

        fun get(context: Context): LocalDb =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(context.applicationContext, LocalDb::class.java, "nexguard.db")
                    .build()
                    .also { instance = it }
            }
    }
}
